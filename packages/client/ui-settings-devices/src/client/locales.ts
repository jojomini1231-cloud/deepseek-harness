/** Locale bundles for the device-management settings page. */

/** Browsers the page names from a User-Agent; `other` keeps the raw string. */
export type DeviceBrowserKey = 'chrome' | 'edge' | 'firefox' | 'safari' | 'other'

/** Operating systems the page names from a User-Agent. */
export type DevicePlatformKey = 'macos' | 'windows' | 'linux' | 'android' | 'ios' | 'other'

/** Locale keys the page renders. */
export type DeviceSettingsLocaleKey =
  | 'nav' | 'title' | 'description'
  | 'loading' | 'empty'
  | 'loadFailed' | 'signedOut' | 'retry'
  | 'firstSeen' | 'lastSeen' | 'address'
  | 'rename' | 'renameDevice' | 'renameTitle' | 'renameLabel' | 'renamePlaceholder' | 'renameHint' | 'save' | 'cancel' | 'renameFailed'
  | 'revoke' | 'revokeDevice' | 'revokeTitle' | 'revokeMessage' | 'revokeConfirm' | 'revokeFailed'
  | 'browser.chrome' | 'browser.edge' | 'browser.firefox' | 'browser.safari' | 'browser.other'
  | 'platform.macos' | 'platform.windows' | 'platform.linux' | 'platform.android' | 'platform.ios' | 'platform.other'
  | 'time.now' | 'time.minutes' | 'time.hours' | 'time.days' | 'time.months' | 'time.years'

/** English copy. */
export const en: Record<DeviceSettingsLocaleKey, string> = {
  nav: 'Devices',
  title: 'Devices',
  description: 'Browsers that have signed in to this deployment. Revoking one signs it out immediately; it can return only by opening the URL printed by dsh web again.',
  loading: 'Reading the device list…',
  empty: 'No browser has signed in yet.',
  loadFailed: 'The device list could not be read.',
  signedOut: 'This browser has been signed out and can no longer read the device list. Open the URL printed by dsh web to sign in again.',
  retry: 'Retry',
  firstSeen: 'First seen',
  lastSeen: 'Last active',
  address: 'Address',
  rename: 'Rename',
  renameDevice: 'Rename {name}',
  renameTitle: 'Rename this device',
  renameLabel: 'Device name',
  renamePlaceholder: 'A name you will recognize',
  renameHint: 'Leave blank to use the name derived from the browser.',
  save: 'Save',
  cancel: 'Cancel',
  renameFailed: 'The deployment did not accept this name.',
  revoke: 'Revoke',
  revokeDevice: 'Revoke {name}',
  revokeTitle: 'Revoke this device?',
  revokeMessage: 'This browser will be signed out on its next request and must open the URL printed by dsh web again. If it is the browser you are using now, you will be signed out too.',
  revokeConfirm: 'Revoke device',
  revokeFailed: 'The deployment did not revoke this device.',
  'browser.chrome': 'Chrome',
  'browser.edge': 'Edge',
  'browser.firefox': 'Firefox',
  'browser.safari': 'Safari',
  'browser.other': 'Browser',
  'platform.macos': 'macOS',
  'platform.windows': 'Windows',
  'platform.linux': 'Linux',
  'platform.android': 'Android',
  'platform.ios': 'iOS',
  'platform.other': 'Unknown system',
  'time.now': 'just now',
  'time.minutes': '{n} min ago',
  'time.hours': '{n} h ago',
  'time.days': '{n} d ago',
  'time.months': '{n} mo ago',
  'time.years': '{n} y ago',
}

/** Simplified Chinese copy. */
export const zh: Record<DeviceSettingsLocaleKey, string> = {
  nav: '设备管理',
  title: '设备管理',
  description: '登录过本部署的浏览器。撤销会立刻让它退出登录，只有重新打开 dsh web 打印的链接才能回来。',
  loading: '正在读取设备列表…',
  empty: '还没有浏览器登录过。',
  loadFailed: '读取设备列表失败。',
  signedOut: '该浏览器已退出登录，无法再读取设备列表。请重新打开 dsh web 打印的链接登录。',
  retry: '重试',
  firstSeen: '首次访问',
  lastSeen: '最近活跃',
  address: '地址',
  rename: '重命名',
  renameDevice: '重命名 {name}',
  renameTitle: '重命名该设备',
  renameLabel: '设备名称',
  renamePlaceholder: '起一个你认得出的名字',
  renameHint: '留空则使用根据浏览器解析出的名称。',
  save: '保存',
  cancel: '取消',
  renameFailed: '本部署没有接受这个名称。',
  revoke: '撤销',
  revokeDevice: '撤销 {name}',
  revokeTitle: '要撤销该设备吗？',
  revokeMessage: '该浏览器会在下一次请求时退出登录，必须重新打开 dsh web 打印的链接才能回来。如果它就是你正在使用的浏览器，你也会被一起退出。',
  revokeConfirm: '确认撤销',
  revokeFailed: '本部署没有撤销该设备。',
  'browser.chrome': 'Chrome',
  'browser.edge': 'Edge',
  'browser.firefox': 'Firefox',
  'browser.safari': 'Safari',
  'browser.other': '浏览器',
  'platform.macos': 'macOS',
  'platform.windows': 'Windows',
  'platform.linux': 'Linux',
  'platform.android': 'Android',
  'platform.ios': 'iOS',
  'platform.other': '未知系统',
  'time.now': '刚刚',
  'time.minutes': '{n} 分钟前',
  'time.hours': '{n} 小时前',
  'time.days': '{n} 天前',
  'time.months': '{n} 个月前',
  'time.years': '{n} 年前',
}
