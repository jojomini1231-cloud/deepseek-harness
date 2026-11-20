/** Notification copy for the Session events this package reports, in every built-in language. */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

/** English notification copy. */
export const en = {
  pending: 'Waiting for your input',
  completed: 'Turn completed',
  failed: 'Turn failed',
  untitled: 'Session',
}
/** Chinese notification copy. */
export const zh = {
  pending: '等待你的输入',
  completed: '本轮已完成',
  failed: '本轮执行失败',
  untitled: '会话',
}
/** Japanese notification copy. */
export const ja = {
  pending: '入力待ちです',
  completed: 'ターンが完了しました',
  failed: 'ターンが失敗しました',
  untitled: 'セッション',
}
/** Spanish notification copy. */
export const es = {
  pending: 'Esperando tu respuesta',
  completed: 'Turno completado',
  failed: 'El turno falló',
  untitled: 'Sesión',
}
/** French notification copy. */
export const fr = {
  pending: 'En attente de votre réponse',
  completed: 'Tour terminé',
  failed: 'Le tour a échoué',
  untitled: 'Session',
}
/** German notification copy. */
export const de = {
  pending: 'Wartet auf deine Eingabe',
  completed: 'Durchlauf abgeschlossen',
  failed: 'Durchlauf fehlgeschlagen',
  untitled: 'Sitzung',
}
/** Russian notification copy. */
export const ru = {
  pending: 'Ожидает вашего ответа',
  completed: 'Ход завершён',
  failed: 'Ход завершился ошибкой',
  untitled: 'Сеанс',
}
/** Portuguese notification copy. */
export const pt = {
  pending: 'Aguardando sua resposta',
  completed: 'Turno concluído',
  failed: 'O turno falhou',
  untitled: 'Sessão',
}

/** Notification copy keys. */
export type SessionNotificationsKey = keyof typeof en

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Session notification copy. */
    'session.notifications': SessionNotificationsKey
  }
}
