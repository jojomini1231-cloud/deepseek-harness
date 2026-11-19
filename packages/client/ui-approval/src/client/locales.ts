/** `approval` namespace dictionaries. */

/** Simplified Chinese dictionary and key-set source of truth. */
export const zh = {
  waiting: '等待审批',
  'detail.aria': '审批详情',
  escalation: '工具 {toolName} 请求越权执行',
  reject: '拒绝',
  allow: '允许',
  allowOnce: '允许一次',
  allowAlways: '始终允许',

  'peek.risk': '完整权限',
  'peek.write': '写入',
  'peek.permission': '权限',
  'peek.open': '查看会话',
  'peek.payloadShow': '展开原始负载',
  'peek.payloadHide': '收起原始负载',
  'peek.confirm': '允许后，本次操作将以 {mode} 权限执行，可能包含不可撤销的破坏。',
  'peek.cancel': '取消',
  'peek.confirmAllow': '确认允许',
  'inbox.title': '等待审批',
  'inbox.count': '{count} 个会话待审批',
  'inbox.denyAll': '全部拒绝',
  'inbox.allowAll': '全部允许',
  'inbox.needsReview': '含完整权限操作，需逐条确认',
} satisfies Record<string, string>

/** Approval dictionary key union. */
export type ApprovalKey = keyof typeof zh

/** English dictionary, checked against the Chinese key set. */
export const en = {
  waiting: 'Waiting for approval',
  'detail.aria': 'Approval details',
  escalation: 'Tool {toolName} requests privileged execution',
  reject: 'Reject',
  allow: 'Allow',
  allowOnce: 'Allow once',
  allowAlways: 'Always allow',

  'peek.risk': 'Full access',
  'peek.write': 'Write',
  'peek.permission': 'Permission',
  'peek.open': 'Open session',
  'peek.payloadShow': 'Show raw payload',
  'peek.payloadHide': 'Hide raw payload',
  'peek.confirm': 'Allowing runs this operation with {mode} permissions and may destroy data irreversibly.',
  'peek.cancel': 'Cancel',
  'peek.confirmAllow': 'Allow anyway',
  'inbox.title': 'Waiting for approval',
  'inbox.count': '{count} awaiting decision',
  'inbox.denyAll': 'Reject all',
  'inbox.allowAll': 'Allow all',
  'inbox.needsReview': 'Full-access requests need a separate decision.',
} satisfies Record<ApprovalKey, string>

/** Japanese copy, checked against the English keys. */
export const ja = {
  'waiting': '承認待ち',
  'detail.aria': '承認の詳細',
  'escalation': 'ツール {toolName} が特権実行を要求しています',
  'reject': '拒否',
  'allow': '許可',
  'allowOnce': '1 回だけ許可',
  'allowAlways': '常に許可',

  'peek.risk': '完全アクセス',
  'peek.write': '書き込み',
  'peek.permission': '権限',
  'peek.open': 'セッションを開く',
  'peek.payloadShow': '生のペイロードを表示',
  'peek.payloadHide': '生のペイロードを隠す',
  'peek.confirm': '許可すると {mode} 権限で実行され、取り消せない破壊を伴う場合があります。',
  'peek.cancel': 'キャンセル',
  'peek.confirmAllow': 'それでも許可',
  'inbox.title': '承認待ち',
  'inbox.count': '{count} 件のセッションが承認待ち',
  'inbox.denyAll': 'すべて拒否',
  'inbox.allowAll': 'すべて許可',
  'inbox.needsReview': '完全アクセスの要求は個別に確認が必要です。',
} satisfies Record<keyof typeof en, string>

/** Spanish dictionary, checked against the English keys. */
export const es = {
  waiting: 'Esperando aprobación',
  'detail.aria': 'Detalles de aprobación',
  escalation: 'La herramienta {toolName} solicita ejecución privilegiada',
  reject: 'Rechazar',
  allow: 'Permitir',
  allowOnce: 'permitir una vez',
  allowAlways: 'Permitir siempre',

  'peek.risk': 'Acceso completo',
  'peek.write': 'Escritura',
  'peek.permission': 'Permiso',
  'peek.open': 'Abrir sesión',
  'peek.payloadShow': 'Mostrar carga sin procesar',
  'peek.payloadHide': 'Ocultar carga sin procesar',
  'peek.confirm': 'Al permitir, la operación se ejecuta con permisos {mode} y puede destruir datos de forma irreversible.',
  'peek.cancel': 'Cancelar',
  'peek.confirmAllow': 'Permitir igualmente',
  'inbox.title': 'Esperando aprobación',
  'inbox.count': '{count} sesiones esperando',
  'inbox.denyAll': 'Rechazar todo',
  'inbox.allowAll': 'Permitir todo',
  'inbox.needsReview': 'Las solicitudes de acceso completo exigen una decisión individual.',
} satisfies Record<keyof typeof en, string>

/** French dictionary, checked against the English keys. */
export const fr = {
  waiting: "En attente d'approbation",
  'detail.aria': "Détails de l'approbation",
  escalation: "L'outil {toolName} demande une exécution privilégiée",
  reject: 'Rejeter',
  allow: 'Autoriser',
  allowOnce: 'Autoriser une fois',
  allowAlways: 'Toujours autoriser',

  'peek.risk': 'Accès complet',
  'peek.write': 'Écriture',
  'peek.permission': 'Permission',
  'peek.open': 'Ouvrir la session',
  'peek.payloadShow': 'Afficher la charge brute',
  'peek.payloadHide': 'Masquer la charge brute',
  'peek.confirm': "Autoriser exécute l'opération avec les permissions {mode} et peut détruire des données de façon irréversible.",
  'peek.cancel': 'Annuler',
  'peek.confirmAllow': 'Autoriser quand même',
  'inbox.title': "En attente d'approbation",
  'inbox.count': '{count} sessions en attente',
  'inbox.denyAll': 'Tout rejeter',
  'inbox.allowAll': 'Tout autoriser',
  'inbox.needsReview': "Les demandes d'accès complet exigent une décision individuelle.",
} satisfies Record<keyof typeof en, string>

/** German dictionary, checked against the English keys. */
export const de = {
  waiting: 'Warten auf Genehmigung',
  'detail.aria': 'Einzelheiten zur Genehmigung',
  escalation: 'Tool {toolName} fordert privilegierte Ausführung an',
  reject: 'Ablehnen',
  allow: 'Erlauben',
  allowOnce: 'Einmal zulassen',
  allowAlways: 'Immer zulassen',

  'peek.risk': 'Voller Zugriff',
  'peek.write': 'Schreiben',
  'peek.permission': 'Berechtigung',
  'peek.open': 'Sitzung öffnen',
  'peek.payloadShow': 'Rohdaten anzeigen',
  'peek.payloadHide': 'Rohdaten ausblenden',
  'peek.confirm': 'Beim Erlauben läuft dieser Vorgang mit {mode}-Berechtigungen und kann Daten unwiderruflich zerstören.',
  'peek.cancel': 'Abbrechen',
  'peek.confirmAllow': 'Trotzdem erlauben',
  'inbox.title': 'Warten auf Genehmigung',
  'inbox.count': '{count} Sitzungen warten',
  'inbox.denyAll': 'Alle ablehnen',
  'inbox.allowAll': 'Alle erlauben',
  'inbox.needsReview': 'Anfragen mit vollem Zugriff brauchen eine eigene Entscheidung.',
} satisfies Record<keyof typeof en, string>

/** Russian dictionary, checked against the English keys. */
export const ru = {
  waiting: 'Ожидание одобрения',
  'detail.aria': 'Детали утверждения',
  escalation: 'Инструмент {toolName} запрашивает привилегированное выполнение',
  reject: 'Отклонить',
  allow: 'Разрешить',
  allowOnce: 'Разрешить один раз',
  allowAlways: 'Всегда разрешать',

  'peek.risk': 'Полный доступ',
  'peek.write': 'Запись',
  'peek.permission': 'Разрешение',
  'peek.open': 'Открыть сессию',
  'peek.payloadShow': 'Показать исходные данные',
  'peek.payloadHide': 'Скрыть исходные данные',
  'peek.confirm': 'При разрешении операция выполнится с правами {mode} и может безвозвратно уничтожить данные.',
  'peek.cancel': 'Отмена',
  'peek.confirmAllow': 'Всё равно разрешить',
  'inbox.title': 'Ожидание одобрения',
  'inbox.count': 'Сеансов в ожидании: {count}',
  'inbox.denyAll': 'Отклонить все',
  'inbox.allowAll': 'Разрешить все',
  'inbox.needsReview': 'Запросы полного доступа требуют отдельного решения.',
} satisfies Record<keyof typeof en, string>

/** Portuguese dictionary, checked against the English keys. */
export const pt = {
  waiting: 'Aguardando aprovação',
  'detail.aria': 'Detalhes de aprovação',
  escalation: 'A ferramenta {toolName} solicita execução privilegiada',
  reject: 'Rejeitar',
  allow: 'Permitir',
  allowOnce: 'Permitir uma vez',
  allowAlways: 'Sempre permitir',

  'peek.risk': 'Acesso total',
  'peek.write': 'Escrita',
  'peek.permission': 'Permissão',
  'peek.open': 'Abrir sessão',
  'peek.payloadShow': 'Mostrar carga bruta',
  'peek.payloadHide': 'Ocultar carga bruta',
  'peek.confirm': 'Ao permitir, a operação executa com permissões {mode} e pode destruir dados de forma irreversível.',
  'peek.cancel': 'Cancelar',
  'peek.confirmAllow': 'Permitir mesmo assim',
  'inbox.title': 'Aguardando aprovação',
  'inbox.count': '{count} sessões aguardando',
  'inbox.denyAll': 'Rejeitar tudo',
  'inbox.allowAll': 'Permitir tudo',
  'inbox.needsReview': 'Pedidos de acesso total exigem decisão individual.',
} satisfies Record<keyof typeof en, string>
