/**
 * The permanent-deletion action for temporary Sessions: a
 * `sidebar.workspaces.session.menu.item` row and a
 * `sidebar.workspaces.session.row.action` button over one injected behavior,
 * plus the `shell.overlay` dialog that confirms the deletion. Both entries
 * render only for a row the browser marked temporary, because only such a
 * Session has a Session-local directory the deletion also removes. The notice
 * a successful deletion raises and the diagnostics for Host rejections live
 * in the injected callbacks, not here.
 */
import { useState } from 'react'
import type { SessionActivity } from '@deepseek-ai/dsh-api-workspace-controller/client'
// Type-only: the family keys each provider merges; a key this program did not compile takes the generic line.
import type {} from '@deepseek-ai/dsh-agent/types'
import type {} from '@deepseek-ai/dsh-jobs/view'
import type {} from '@deepseek-ai/dsh-schedule/client'
import type {} from '@deepseek-ai/dsh-subagent/client'
import {
  Button, IconTrashOutlineRegular, MenuItemButton, Modal, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  DeleteSessionInjected, SessionDeleteConfirmInjected, SessionDeleteConfirmProps, SessionDeleteConfirmRequest,
  SessionMenuItemProps, SessionRowActionProps,
} from '../contract/slots.ts'
import css from '../rows/Rows.module.css'
import browserCss from '../rows/WorkspaceBrowser.module.css'

/**
 * Menu row (order 500): the last row, separated from the reversible actions
 * above it; absent on every non-temporary Session.
 * @param props - owner share, the delete share, and the menu open state.
 * @returns the row, or null for a non-temporary Session.
 */
export function DeleteSessionMenuItem(props: SessionMenuItemProps<DeleteSessionInjected>) {
  const { sessionId, displayTitle, temporary, useMenuOpenState, requestSessionDelete, t } = props
  const [, setMenuOpen] = useMenuOpenState()
  if (!temporary) return null
  return (
    <MenuItemButton
      danger
      separatorBefore
      icon={<IconTrashOutlineRegular size={14} />}
      onSelect={() => {
        setMenuOpen(false)
        requestSessionDelete(sessionId, displayTitle)
      }}
    >
      {t('menu.deleteSession')}
    </MenuItemButton>
  )
}

/**
 * Hover button (order 300): the trailing destructive action; absent on every
 * non-temporary Session.
 * @param props - owner share and the delete share.
 * @returns the button, or null for a non-temporary Session.
 */
export function DeleteSessionRowButton(props: SessionRowActionProps<DeleteSessionInjected>) {
  const { sessionId, displayTitle, temporary, requestSessionDelete, t } = props
  if (!temporary) return null
  return (
    <Tooltip label={t('actions.delete')} side="bottom" align="end" delayMs={500}>
      <button
        type="button"
        className={css.iconButton}
        aria-label={t('menu.deleteSession')}
        onClick={() => { requestSessionDelete(sessionId, displayTitle) }}
      >
        <IconTrashOutlineRegular size={14} />
      </button>
    </Tooltip>
  )
}

/**
 * The `shell.overlay` entry: nothing while no confirmation is pending,
 * otherwise one dialog per request (keyed by the Session). Confirming asks the
 * Host to delete; a request carrying reported activity means the Host refused
 * the plain deletion, and the same button then stops that work first.
 * @param props - the request hook, its settlement, the deletion hop, and the locale seat.
 * @returns the open dialog, or null.
 */
export function SessionDeleteConfirmDialog({
  useDeleteRequest, settleSessionDelete, deleteSession, t,
}: SessionDeleteConfirmProps) {
  const request = useDeleteRequest(pending => pending)
  if (request === null) return null
  return (
    <DeleteConfirmForm
      key={request.sessionId}
      request={request}
      deleteSession={deleteSession}
      onSettle={settleSessionDelete}
      t={t}
    />
  )
}

/** One request's dialog: in-flight and error state die with it. */
function DeleteConfirmForm({ request, deleteSession, onSettle, t }: {
  request: SessionDeleteConfirmRequest
  deleteSession: SessionDeleteConfirmInjected['deleteSession']
  onSettle: () => void
  t: SessionDeleteConfirmProps['t']
}) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The work the Host reported still running. Its presence is what turns this
  // from a confirmation into a stop-then-delete confirmation, so it starts
  // empty: the dialog knows nothing until it asks.
  const [activity, setActivity] = useState<readonly SessionActivity[]>([])
  const close = () => {
    if (deleting) return
    onSettle()
  }
  const confirm = () => {
    setDeleting(true)
    setError(null)
    deleteSession(request.sessionId, activity.length > 0 ? { stopActivity: true } : {})
      .then((refused) => {
        setDeleting(false)
        if (refused !== undefined) {
          setActivity(refused)
          return
        }
        onSettle()
      })
      .catch((reason: unknown) => {
        setDeleting(false)
        setError(reason instanceof Error ? reason.message : String(reason))
      })
  }
  return (
    <Modal
      open
      onClose={close}
      closeLabel={t('close')}
      title={t('delete.session.title')}
      description={t('delete.session.desc', { title: request.displayTitle })}
      footer={(
        <>
          <Button variant="outline" disabled={deleting} onClick={close}>{t('cancel')}</Button>
          <Button
            variant="outline"
            className={browserCss.deleteAction}
            disabled={deleting}
            onClick={confirm}
          >
            {t(activity.length > 0 ? 'delete.session.stopAndDelete' : 'delete.session.action')}
          </Button>
        </>
      )}
    >
      <div className={browserCss.deleteWarning} role="note">{t('delete.session.warning')}</div>
      {activity.length > 0 && (
        <ul className={browserCss.archiveActivity} aria-label={t('delete.session.activity')}>
          {activity.map((entry, index) => (
            <li key={`${entry.kind}-${String(index)}`}>{activityLine(entry, t)}</li>
          ))}
        </ul>
      )}
      {deleting && <div className={browserCss.deleteStatus} role="status">{t('delete.session.pending')}</div>}
      {error !== null && <div className={browserCss.renameError} role="alert">{error}</div>}
    </Modal>
  )
}

/**
 * One family's line: its count and the items' labels (ids when a family
 * carries no label). A family this dictionary does not know — a provider
 * merged into the kind map — falls through to the generic line.
 */
function activityLine(entry: SessionActivity, t: SessionDeleteConfirmProps['t']): string {
  const items = entry.items ?? []
  const n = items.length
  const names = items.map(item => item.label ?? item.id).join(t('archive.confirm.listSeparator'))
  const plural = n === 1 ? 'one' : 'other'
  switch (entry.kind) {
    case 'turn': return t('archive.confirm.turn')
    case 'subagent': return t(`archive.confirm.subagents.${plural}`, { n, names })
    case 'job': return t(`archive.confirm.jobs.${plural}`, { n, names })
    case 'schedule': return t(`archive.confirm.schedules.${plural}`, { n, names })
    default: return t(`archive.confirm.other.${plural}`, { kind: entry.kind, n })
  }
}
