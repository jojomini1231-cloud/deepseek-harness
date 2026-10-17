/**
 * `sidebarFiles` namespace dictionaries, and the namespace's declaration.
 *
 * The failure lines name what the tree could not list, one code each, because a
 * directory that is gone, one outside the workspace, and a path that is not a
 * directory each suggest a different next step. The workbench's own copy names
 * its chips, its divider, and the content column before a file is chosen.
 *
 * The namespace merge lives with its key set so that any module naming
 * `TranslateNS<'sidebarFiles'>` or `PropsLocale<'sidebarFiles'>` needs only this
 * file, whichever entry a program loads first.
 */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Workbench type name, guide entry, row and chip states, divider, and failure lines. */
    sidebarFiles: SidebarFilesKey
  }
}

/** Simplified Chinese dictionary and key-set source of truth. */
export const zh = {
  'shortcut.noSession': '请先选择会话',
  'type.label': '文件',
  'guide.title': '工作区文件',
  'guide.description': '浏览会话工作区的文件',
  loading: '正在读取…',
  empty: '空目录',
  truncated: '条目太多，只显示了一部分。',
  noWorkspace: '这个会话没有工作区目录。',
  reload: '重新读取',
  autoRefresh: '自动刷新',
  'autoRefresh.enable': '开启自动刷新',
  'autoRefresh.disable': '关闭自动刷新',
  'entry.other': '这不是文件或目录，没法打开。',
  'rail.aria': '视图容器',
  'rail.git': 'Git 变更',
  'git.title': 'Git',
  'git.refresh': '重新读取工作区状态',
  'git.changes': '更改',
  'git.untracked': '未跟踪文件',
  'git.clean': '工作区没有未提交的更改',
  'git.truncated': '显示 {shown} / {total} 个更改',
  'git.loading': '正在读取工作区状态…',
  'git.failed': '无法读取工作区状态',
  retry: '重试',
  'git.diff.none': '选择一个更改以查看差异',
  'git.diff.loading': '正在读取差异…',
  'git.diff.failed': '无法读取该文件的差异',
  'git.diff.empty': '没有行级差异',
  'git.diff.binary': '二进制文件，不显示差异',
  'git.diff.created': '新文件',
  'diff.mode.aria': '差异布局',
  'diff.mode.unified': '单栏',
  'diff.mode.split': '左右',
  'diff.coarse': '改动过多，已按整文件替换显示',
  'diff.truncated': '仅显示前 {count} 行',
  'git.diff.oversized': '文件过大，不显示差异',
  'rail.files': '文件',
  'tree.title': '项目',
  'tree.actions.aria': '文件树操作',
  'tree.expand': '展开所有目录',
  'tree.collapse': '收起所有目录',
  'tabs.aria': '打开的文件',
  'tabs.close': '关闭 {name}',
  'tabs.menu.close': '关闭',
  'tabs.menu.closeOthers': '关闭其他标签页',
  'tabs.menu.closeAll': '关闭所有标签页',
  'tabs.menu.closeLeft': '关闭左侧标签页',
  'tabs.menu.closeRight': '关闭右侧标签页',
  'splitter.aria': '调整文件预览与文件树的宽度',
  'splitter.git.aria': '调整差异对比与变更列表的宽度',
  'preview.empty': '从右侧文件树中选择一个文件。',
  'error.notFound': '这个目录不在了。可能已被移动或删除。',
  'error.outsideWorkspace': '这个目录在工作区之外，侧栏不会读取它。',
  'error.notDirectory': '这不是一个目录。',
  'error.unavailable': '读取失败：{message}',
} satisfies Record<string, string>

/** Files dictionary key union. */
export type SidebarFilesKey = keyof typeof zh

/** English dictionary, checked against the Chinese key set. */
export const en = {
  'shortcut.noSession': 'Select a session first',
  'type.label': 'Files',
  'guide.title': 'Workspace files',
  'guide.description': 'Browse files in this session\'s workspace',
  loading: 'Reading…',
  empty: 'Empty directory',
  truncated: 'Too many entries, showing only some of them.',
  noWorkspace: 'This session has no workspace directory.',
  reload: 'Reload',
  autoRefresh: 'Auto refresh',
  'autoRefresh.enable': 'Enable auto refresh',
  'autoRefresh.disable': 'Disable auto refresh',
  'entry.other': 'Not a file or a directory, so it cannot be opened.',
  'rail.aria': 'View containers',
  'rail.git': 'Git changes',
  'git.title': 'Git',
  'git.refresh': 'Read the working tree again',
  'git.changes': 'Changes',
  'git.untracked': 'Untracked Files',
  'git.clean': 'No uncommitted changes',
  'git.truncated': 'Showing {shown} of {total} changes',
  'git.loading': 'Reading the working tree…',
  'git.failed': 'Could not read the working tree',
  retry: 'Retry',
  'git.diff.none': 'Choose a change to see its diff',
  'git.diff.loading': 'Reading the diff…',
  'git.diff.failed': 'Could not read this file’s diff',
  'git.diff.empty': 'No line changes',
  'git.diff.binary': 'Binary file: no diff shown',
  'git.diff.created': 'New file',
  'diff.mode.aria': 'Diff layout',
  'diff.mode.unified': 'Unified',
  'diff.mode.split': 'Split',
  'diff.coarse': 'Too many changes: shown as a whole-file replacement',
  'diff.truncated': 'Showing the first {count} lines',
  'git.diff.oversized': 'File too large: no diff shown',
  'rail.files': 'Files',
  'tree.title': 'Project',
  'tree.actions.aria': 'File tree actions',
  'tree.expand': 'Expand All',
  'tree.collapse': 'Collapse All',
  'tabs.aria': 'Open files',
  'tabs.close': 'Close {name}',
  'tabs.menu.close': 'Close',
  'tabs.menu.closeOthers': 'Close Other Tabs',
  'tabs.menu.closeAll': 'Close All Tabs',
  'tabs.menu.closeLeft': 'Close Tabs to the Left',
  'tabs.menu.closeRight': 'Close Tabs to the Right',
  'splitter.aria': 'Resize the file preview and file tree',
  'splitter.git.aria': 'Resize the comparison and the changed-path list',
  'preview.empty': 'Choose a file from the tree on the right.',
  'error.notFound': 'That directory is gone. It may have been moved or deleted.',
  'error.outsideWorkspace': 'That directory is outside the workspace, so the sidebar will not read it.',
  'error.notDirectory': 'That is not a directory.',
  'error.unavailable': 'Read failed: {message}',
} satisfies Record<SidebarFilesKey, string>
