//! Reads tensors from a PyTorch checkpoint, in both formats torch.save has written: the zip format (torch ≥ 1.6) and the
//! legacy one (GU2Net's 2021 best.pt). The pickle interpreter never imports or calls anything. Globals it understands
//! rebuild tensors and ordered dicts; deny-listed globals refuse the file; every other global becomes an inert placeholder
//! (spec 2026-10-01 Part 2; plan ruling 1).
use std::{cell::RefCell, collections::BTreeMap, io::Read, path::Path, rc::Rc};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DType { F32, F64, F16, BF16, I64, I32, I16, I8, U8, Bool }
impl DType {
    pub fn size(self) -> usize { match self { Self::F64 | Self::I64 => 8, Self::F32 | Self::I32 => 4, Self::F16 | Self::BF16 | Self::I16 => 2, _ => 1 } }
    pub fn onnx_name(self) -> &'static str {
        match self { Self::F32 => "float32", Self::F64 => "float64", Self::F16 => "float16", Self::BF16 => "bfloat16",
            Self::I64 => "int64", Self::I32 => "int32", Self::I16 => "int16", Self::I8 => "int8", Self::U8 => "uint8", Self::Bool => "bool" }
    }
    fn from_storage(name: &str) -> Option<Self> {
        Some(match name { "FloatStorage" => Self::F32, "DoubleStorage" => Self::F64, "HalfStorage" => Self::F16, "BFloat16Storage" => Self::BF16,
            "LongStorage" => Self::I64, "IntStorage" => Self::I32, "ShortStorage" => Self::I16, "CharStorage" => Self::I8,
            "ByteStorage" => Self::U8, "BoolStorage" => Self::Bool, _ => return None })
    }
}
/// A tensor's little-endian bytes in C order.
#[derive(Clone, Debug, PartialEq)]
pub struct Tensor { pub dtype: DType, pub shape: Vec<usize>, pub data: Vec<u8> }

#[derive(Debug)]
pub enum PthError { NotPyTorch, Unsafe(String), Format(String), NoStateDict }
impl std::fmt::Display for PthError {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        match self {
            Self::NotPyTorch => write!(f, "not a PyTorch file"),
            Self::Unsafe(g) => write!(f, "the file asks to run {g}"),
            Self::Format(m) => write!(f, "unreadable PyTorch file: {m}"),
            Self::NoStateDict => write!(f, "no model weights found in the file"),
        }
    }
}
impl std::error::Error for PthError {}
fn fmt_err(e: impl std::fmt::Display) -> PthError { PthError::Format(e.to_string()) }

/// Modules and builtins whose presence means the file wants to run code: refuse it.
const DENY_MODULES: &[&str] = &["os", "posix", "nt", "subprocess", "sys", "shutil", "socket", "importlib", "runpy", "pty", "ctypes",
    "pickle", "_pickle", "marshal", "code", "codeop", "webbrowser", "multiprocessing", "asyncio", "signal", "threading", "tempfile", "io", "glob", "pathlib"];
/// `getattr` is here because real checkpoints use it: a pickled learning-rate scheduler stores bound methods as
/// getattr(obj, name) (GU2Net's best.pt does). Nothing is ever called, and every module that could run code is refused.
const SAFE_BUILTINS: &[&str] = &["set", "frozenset", "slice", "complex", "bytearray", "bytes", "tuple", "list", "dict", "int", "float", "str", "bool", "object", "getattr"];
fn denied(module: &str, name: &str) -> bool {
    let root = module.split('.').next().unwrap_or(module);
    DENY_MODULES.contains(&root) || (matches!(module, "builtins" | "__builtin__") && !SAFE_BUILTINS.contains(&name))
}

type List = Rc<RefCell<Vec<V>>>;
type Dict = Rc<RefCell<Vec<(V, V)>>>;
#[derive(Clone, Debug)]
#[allow(dead_code)]   // some payloads are only for Debug output when a file is refused
enum V {
    None, Bool(bool), Int(i64), Float(f64), Str(String), Bytes(Vec<u8>),
    Tuple(Rc<Vec<V>>), List(List), Dict(Dict),
    Global(String, String),
    Storage { dtype: DType, key: String },
    Tensor { dtype: DType, key: String, offset: usize, shape: Vec<usize>, stride: Vec<usize> },
    Opaque(String),
    Mark,
}

/// One pickle, from `b[i..]` to its STOP. Records each storage's type by key.
struct Vm<'a> { b: &'a [u8], i: usize, stack: Vec<V>, memo: BTreeMap<u32, V>, storages: BTreeMap<String, DType> }
impl<'a> Vm<'a> {
    fn new(b: &'a [u8], i: usize) -> Self { Self { b, i, stack: vec![], memo: BTreeMap::new(), storages: BTreeMap::new() } }
    fn take(&mut self, n: usize) -> Result<&'a [u8], PthError> {
        let s = self.b.get(self.i..self.i + n).ok_or_else(|| fmt_err("truncated pickle"))?;
        self.i += n; Ok(s)
    }
    fn u8(&mut self) -> Result<u8, PthError> { Ok(self.take(1)?[0]) }
    fn u32(&mut self) -> Result<u32, PthError> { Ok(u32::from_le_bytes(self.take(4)?.try_into().expect("4 bytes"))) }
    fn u64(&mut self) -> Result<u64, PthError> { Ok(u64::from_le_bytes(self.take(8)?.try_into().expect("8 bytes"))) }
    fn line(&mut self) -> Result<String, PthError> {
        let end = self.b[self.i..].iter().position(|&c| c == b'\n').ok_or_else(|| fmt_err("unterminated line"))?;
        let s = String::from_utf8_lossy(&self.b[self.i..self.i + end]).into_owned(); self.i += end + 1; Ok(s)
    }
    fn text(&mut self, n: usize) -> Result<V, PthError> { Ok(V::Str(String::from_utf8_lossy(self.take(n)?).into_owned())) }
    fn pop(&mut self) -> Result<V, PthError> { self.stack.pop().ok_or_else(|| fmt_err("stack underflow")) }
    fn pop_mark(&mut self) -> Result<Vec<V>, PthError> {
        let at = self.stack.iter().rposition(|v| matches!(v, V::Mark)).ok_or_else(|| fmt_err("no mark"))?;
        let items = self.stack.split_off(at + 1); self.stack.pop(); Ok(items)
    }
    fn top(&mut self) -> Result<&mut V, PthError> { self.stack.last_mut().ok_or_else(|| fmt_err("empty stack")) }
    fn memo_key(&mut self, op: u8) -> Result<u32, PthError> {
        match op { b'q' | b'h' => Ok(self.u8()? as u32), b'r' | b'j' => self.u32(), _ => self.line()?.trim().parse().map_err(|_| fmt_err("bad memo key")) }
    }
    fn global(&self, m: String, n: String) -> Result<V, PthError> {
        if denied(&m, &n) { return Err(PthError::Unsafe(format!("{m}.{n}"))); }
        Ok(V::Global(m, n))
    }
    /// What calling `f(args)` would build, worked out without calling anything.
    fn call(f: V, args: V) -> Result<V, PthError> {
        let args: Vec<V> = match args { V::Tuple(t) => (*t).clone(), _ => vec![] };
        Ok(match f {
            V::Global(m, n) if m == "collections" && n == "OrderedDict" => V::Dict(Rc::new(RefCell::new(vec![]))),
            V::Global(m, n) if m == "torch._utils" && n == "_rebuild_tensor_v2" => {
                let arg = |i: usize| args.get(i).cloned().unwrap_or(V::None);
                let (V::Storage { dtype, key }, V::Int(off), V::Tuple(size), V::Tuple(stride)) = (arg(0), arg(1), arg(2), arg(3))
                else { return Err(fmt_err("bad tensor record")) };
                let ints = |t: &Rc<Vec<V>>| t.iter().map(|v| match v { V::Int(i) if *i >= 0 => Ok(*i as usize), _ => Err(fmt_err("bad tensor size")) })
                    .collect::<Result<Vec<_>, _>>();
                V::Tensor { dtype, key, offset: off.max(0) as usize, shape: ints(&size)?, stride: ints(&stride)? }
            }
            V::Global(m, n) if m == "torch._utils" && n.starts_with("_rebuild_parameter") => args.into_iter().next().unwrap_or(V::None),
            V::Global(m, n) => V::Opaque(format!("{m}.{n}")),
            _ => V::Opaque("call".into()),
        })
    }
    fn persistent(&mut self, pid: V) -> Result<V, PthError> {
        if let V::Tuple(t) = &pid {
            if let (Some(V::Str(tag)), Some(V::Global(_, ty)), Some(V::Str(key))) = (t.first(), t.get(1), t.get(2)) {
                if tag == "storage" {
                    if t.get(5).is_some_and(|v| !matches!(v, V::None)) { return Err(fmt_err("storage views are not supported")); }
                    let dtype = DType::from_storage(ty).ok_or_else(|| fmt_err(format!("unsupported storage {ty}")))?;
                    self.storages.insert(key.clone(), dtype);
                    return Ok(V::Storage { dtype, key: key.clone() });
                }
            }
        }
        Ok(V::Opaque("persistent id".into()))
    }
    fn run(&mut self) -> Result<V, PthError> {
        loop {
            let op = self.u8()?;
            match op {
                0x80 => { self.u8()?; }                                                          // PROTO
                0x95 => { self.u64()?; }                                                         // FRAME
                b'.' => return self.pop(),                                                       // STOP
                b'(' => self.stack.push(V::Mark),
                b'0' => { self.pop()?; }
                b'1' => { self.pop_mark()?; }
                b'2' => { let v = self.top()?.clone(); self.stack.push(v); }
                b'}' => self.stack.push(V::Dict(Rc::new(RefCell::new(vec![])))),
                b']' | 0x8f => self.stack.push(V::List(Rc::new(RefCell::new(vec![])))),       // EMPTY_LIST, EMPTY_SET
                b')' => self.stack.push(V::Tuple(Rc::new(vec![]))),
                b't' | 0x91 => { let items = self.pop_mark()?; self.stack.push(V::Tuple(Rc::new(items))); }   // TUPLE, FROZENSET
                0x85 => { let a = self.pop()?; self.stack.push(V::Tuple(Rc::new(vec![a]))); }
                0x86 => { let b = self.pop()?; let a = self.pop()?; self.stack.push(V::Tuple(Rc::new(vec![a, b]))); }
                0x87 => { let c = self.pop()?; let b = self.pop()?; let a = self.pop()?; self.stack.push(V::Tuple(Rc::new(vec![a, b, c]))); }
                b'l' => { let items = self.pop_mark()?; self.stack.push(V::List(Rc::new(RefCell::new(items)))); }
                b'd' => { let items = self.pop_mark()?;
                          let kv = items.chunks(2).filter(|c| c.len() == 2).map(|c| (c[0].clone(), c[1].clone())).collect();
                          self.stack.push(V::Dict(Rc::new(RefCell::new(kv)))); }
                b'a' => { let v = self.pop()?; if let V::List(l) = self.top()? { l.borrow_mut().push(v); } }
                b'e' | 0x90 => { let items = self.pop_mark()?; if let V::List(l) = self.top()? { l.borrow_mut().extend(items); } }   // APPENDS, ADDITEMS
                b's' => { let v = self.pop()?; let k = self.pop()?; if let V::Dict(d) = self.top()? { d.borrow_mut().push((k, v)); } }
                b'u' => { let items = self.pop_mark()?; if let V::Dict(d) = self.top()? {
                              d.borrow_mut().extend(items.chunks(2).filter(|c| c.len() == 2).map(|c| (c[0].clone(), c[1].clone()))); } }
                b'N' => self.stack.push(V::None),
                0x88 => self.stack.push(V::Bool(true)),
                0x89 => self.stack.push(V::Bool(false)),
                b'J' => { let v = i32::from_le_bytes(self.take(4)?.try_into().expect("4 bytes")); self.stack.push(V::Int(v as i64)); }
                b'K' => { let v = self.u8()?; self.stack.push(V::Int(v as i64)); }
                b'M' => { let v = u16::from_le_bytes(self.take(2)?.try_into().expect("2 bytes")); self.stack.push(V::Int(v as i64)); }
                0x8a | 0x8b => {                                                                 // LONG1 / LONG4
                    let n = if op == 0x8a { self.u8()? as usize } else { self.u32()? as usize };
                    let bytes = self.take(n)?;
                    if n > 8 { self.stack.push(V::Bytes(bytes.to_vec())); continue; }           // e.g. the legacy magic number
                    let mut v: i64 = 0;
                    for (k, b) in bytes.iter().enumerate() { v |= (*b as i64) << (8 * k); }
                    if n > 0 && n < 8 && bytes[n - 1] & 0x80 != 0 { v -= 1i64 << (8 * n); }
                    self.stack.push(V::Int(v));
                }
                b'I' | b'L' => { let s = self.line()?; let s = s.trim().trim_end_matches('L');
                          self.stack.push(match s { "01" => V::Bool(true), "00" => V::Bool(false), _ => V::Int(s.parse().unwrap_or(0)) }); }
                b'F' => { let s = self.line()?; self.stack.push(V::Float(s.trim().parse().unwrap_or(0.0))); }
                b'G' => { let v = f64::from_be_bytes(self.take(8)?.try_into().expect("8 bytes")); self.stack.push(V::Float(v)); }
                b'X' | b'T' => { let n = self.u32()? as usize; let v = self.text(n)?; self.stack.push(v); }
                0x8c | b'U' => { let n = self.u8()? as usize; let v = self.text(n)?; self.stack.push(v); }
                0x8d => { let n = self.u64()? as usize; let v = self.text(n)?; self.stack.push(v); }
                b'V' | b'S' => { let s = self.line()?; self.stack.push(V::Str(s)); }
                b'B' => { let n = self.u32()? as usize; let v = self.take(n)?.to_vec(); self.stack.push(V::Bytes(v)); }
                b'C' => { let n = self.u8()? as usize; let v = self.take(n)?.to_vec(); self.stack.push(V::Bytes(v)); }
                0x8e | 0x96 => { let n = self.u64()? as usize; let v = self.take(n)?.to_vec(); self.stack.push(V::Bytes(v)); }
                b'c' => { let m = self.line()?; let n = self.line()?; let g = self.global(m, n)?; self.stack.push(g); }
                0x93 => { let n = self.pop()?; let m = self.pop()?;                              // STACK_GLOBAL
                          let (V::Str(m), V::Str(n)) = (m, n) else { return Err(fmt_err("bad global")) };
                          let g = self.global(m, n)?; self.stack.push(g); }
                b'R' | 0x81 => { let args = self.pop()?; let f = self.pop()?; self.stack.push(Self::call(f, args)?); }   // REDUCE, NEWOBJ
                0x92 => { self.pop()?; let args = self.pop()?; let f = self.pop()?; self.stack.push(Self::call(f, args)?); } // NEWOBJ_EX
                b'b' => { self.pop()?; }                                                         // BUILD: state ignored
                b'Q' => { let pid = self.pop()?; let v = self.persistent(pid)?; self.stack.push(v); }
                b'P' => { self.line()?; self.stack.push(V::Opaque("persistent id".into())); }
                b'q' | b'r' | b'p' => { let k = self.memo_key(op)?; let v = self.top()?.clone(); self.memo.insert(k, v); }
                0x94 => { let k = self.memo.len() as u32; let v = self.top()?.clone(); self.memo.insert(k, v); }
                b'h' | b'j' | b'g' => { let k = self.memo_key(op)?;
                          let v = self.memo.get(&k).cloned().ok_or_else(|| fmt_err("missing memo entry"))?; self.stack.push(v); }
                other => return Err(fmt_err(format!("unsupported pickle opcode 0x{other:02x}"))),
            }
        }
    }
}

/// The checkpoint's top-level object and each storage's type and bytes, by key.
type Loaded = (V, BTreeMap<String, (DType, Vec<u8>)>);
fn load(file: &Path) -> Result<Loaded, PthError> {
    let mut head = [0u8; 4];
    std::fs::File::open(file).and_then(|mut f| f.read_exact(&mut head)).map_err(|_| PthError::NotPyTorch)?;
    if head == *b"PK\x03\x04" { load_zip(file) } else if head == [0x80, 0x02, 0x8a, 0x0a] { load_legacy(&std::fs::read(file).map_err(fmt_err)?) } else { Err(PthError::NotPyTorch) }
}

fn load_zip(file: &Path) -> Result<Loaded, PthError> {
    let mut z = zip::ZipArchive::new(std::fs::File::open(file).map_err(fmt_err)?).map_err(|_| PthError::NotPyTorch)?;
    let pkl_name = (0..z.len()).filter_map(|i| z.name_for_index(i).map(str::to_string)).find(|n| n.ends_with("data.pkl"))
        .ok_or_else(|| fmt_err("no data.pkl"))?;
    let prefix = pkl_name.trim_end_matches("data.pkl").to_string();
    if let Ok(mut bo) = z.by_name(&format!("{prefix}byteorder")) {
        let mut s = String::new(); bo.read_to_string(&mut s).ok();
        if s.trim() == "big" { return Err(fmt_err("big-endian files are not supported")); }
    }
    let mut pkl = Vec::new();
    z.by_name(&pkl_name).map_err(fmt_err)?.read_to_end(&mut pkl).map_err(fmt_err)?;
    let mut vm = Vm::new(&pkl, 0);
    let top = vm.run()?;
    let mut storages = BTreeMap::new();
    for (key, dtype) in vm.storages {
        let mut raw = Vec::new();
        z.by_name(&format!("{prefix}data/{key}")).map_err(fmt_err)?.read_to_end(&mut raw).map_err(fmt_err)?;
        storages.insert(key, (dtype, raw));
    }
    Ok((top, storages))
}

/// torch < 1.6: magic pickle, protocol pickle, sys-info pickle, the object pickle, the storage-key list pickle, then
/// each storage in that order as an int64 element count followed by its raw little-endian data.
fn load_legacy(b: &[u8]) -> Result<Loaded, PthError> {
    const MAGIC: [u8; 10] = [0x6c, 0xfc, 0x9c, 0x46, 0xf9, 0x20, 0x6a, 0xa8, 0x50, 0x19];
    let mut vm = Vm::new(b, 0);
    if !matches!(vm.run()?, V::Bytes(m) if m == MAGIC) { return Err(PthError::NotPyTorch); }
    let mut vm = Vm::new(b, vm.i);
    if !matches!(vm.run()?, V::Int(1001)) { return Err(fmt_err("unknown legacy protocol")); }
    let mut vm = Vm::new(b, vm.i);
    vm.run()?;                                                                                   // sys info: unused
    let mut main = Vm::new(b, vm.i);
    let top = main.run()?;
    let mut keys_vm = Vm::new(b, main.i);
    let V::List(keys) = keys_vm.run()? else { return Err(fmt_err("no storage key list")) };
    let mut at = keys_vm.i;
    let mut storages = BTreeMap::new();
    for k in keys.borrow().iter() {
        let V::Str(key) = k else { return Err(fmt_err("bad storage key")) };
        let dtype = *main.storages.get(key).ok_or_else(|| fmt_err(format!("storage {key} has no type")))?;
        let n = u64::from_le_bytes(b.get(at..at + 8).ok_or_else(|| fmt_err("truncated storage"))?.try_into().expect("8 bytes")) as usize;
        let len = n.checked_mul(dtype.size()).ok_or_else(|| fmt_err("storage too large"))?;
        let data = b.get(at + 8..at + 8 + len).ok_or_else(|| fmt_err("truncated storage"))?.to_vec();
        at += 8 + len;
        storages.insert(key.clone(), (dtype, data));
    }
    Ok((top, storages))
}

/// The tensors of the first `keys` entry that is a dict (`""` = the top level), with `strip` prefixes removed.
/// Non-tensor entries (e.g. `_metadata`) are skipped.
pub fn read_state_dict(file: &Path, keys: &[String], strip: &[String]) -> Result<BTreeMap<String, Tensor>, PthError> {
    let (top, storages) = load(file)?;
    let entries = keys.iter().find_map(|k| {
        let V::Dict(d) = &top else { return None };
        if k.is_empty() { return Some(d.borrow().clone()); }
        d.borrow().iter().find_map(|(kk, v)| match (kk, v) { (V::Str(s), V::Dict(inner)) if s == k => Some(inner.borrow().clone()), _ => None })
    }).ok_or(PthError::NoStateDict)?;
    let mut out = BTreeMap::new();
    for (k, v) in entries {
        let (V::Str(name), V::Tensor { dtype, key, offset, shape, stride }) = (k, v) else { continue };
        let (_, raw) = storages.get(&key).ok_or_else(|| fmt_err(format!("storage {key} is missing")))?;
        let name = strip.iter().fold(name, |n, p| n.strip_prefix(p.as_str()).map(str::to_string).unwrap_or(n));
        out.insert(name, Tensor { dtype, data: gather(raw, dtype.size(), offset, &shape, &stride)?, shape });
    }
    if out.is_empty() { return Err(PthError::NoStateDict); }
    Ok(out)
}

/// Copies a strided view out of its storage in C order.
fn gather(raw: &[u8], es: usize, offset: usize, shape: &[usize], stride: &[usize]) -> Result<Vec<u8>, PthError> {
    let n: usize = shape.iter().product();
    let mut out = Vec::with_capacity(n * es);
    let mut idx = vec![0usize; shape.len()];
    for _ in 0..n {
        let pos = offset + idx.iter().zip(stride).map(|(i, s)| i * s).sum::<usize>();
        out.extend_from_slice(raw.get(pos * es..(pos + 1) * es).ok_or_else(|| fmt_err("tensor runs past its storage"))?);
        for d in (0..shape.len()).rev() { idx[d] += 1; if idx[d] < shape[d] { break; } idx[d] = 0; }
    }
    Ok(out)
}
