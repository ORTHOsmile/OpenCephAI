/** Windows-ready rule (master plan §13; preflight Task 8): a shortcut hint names its modifier through this one
 *  helper, never hard-coded, so a Windows build reads "Alt"/"Ctrl" where a Mac build reads "⌥"/"⌘". */
export const isMacLike = () => /Mac|iPhone|iPad/.test(navigator.platform);
export const ALT = () => (isMacLike() ? '⌥' : 'Alt');
export const CMD = () => (isMacLike() ? '⌘' : 'Ctrl');
