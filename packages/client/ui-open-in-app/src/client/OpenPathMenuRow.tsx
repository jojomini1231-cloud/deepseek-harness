/**
 * The chip menu's row for handing a file's folder to the desktop file manager.
 *
 * The gesture is the controller's own reveal: the Host opens the containing
 * folder with the file selected, which is what the document header's control
 * does with the same call and the same copy. The row serializes the gesture
 * through `useOpenTargetGesture`, the same guard the header control uses, so a
 * double activation before the Host answers launches the file manager once. A
 * row that succeeds dismisses the menu; a row that fails keeps the menu open
 * and announces from itself, so the failure is visible while the reader is
 * still where the gesture was made.
 */
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { IconFolderOpenRegular, MenuItemButton } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-files/client'
import type { OpenPathInjected } from './OpenPathAction.tsx'
import { useOpenTargetGesture } from './OpenTargetButton.tsx'
import type { OpenTargetOperation } from './OpenTargetButton.tsx'
import type { NS } from './locales.ts'

/** The row's inputs: the chip's file, the menu's dismiss callback, and the shared path controller. */
export type OpenPathMenuRowProps =
  PropsRuntime<'sidebar.right.tab.files.chip.actions'>
  & PropsLocale<typeof NS>
  & InjectFace<OpenPathInjected>

/**
 * Render the reveal row for a chip whose file the Host can hand to a desktop.
 * @param props - the file's absolute path, the dismiss callback, and injected opening capabilities.
 * @returns the menu row, or nothing when the Host has no desktop.
 */
export function OpenPathMenuRow(props: OpenPathMenuRowProps): ReactNode {
  const desktop = props.useOpenInAppDesktop(value => value)
  const reveal: OpenTargetOperation = { kind: 'reveal' }
  const { pending, toast, act } = useOpenTargetGesture(
    operation => props.openPath(props.path, operation.kind === 'reveal' ? 'reveal' : 'open')
      .then(failure => failure === null ? (props.onPicked(), null) : failure),
    props.t,
  )
  useEffect(() => {
    if (desktop === null) void props.loadDesktop()
  }, [desktop, props.loadDesktop])
  // Without a desktop there is no file manager to hand the path to; the header
  // control follows the same rule rather than offering a dead row.
  if (desktop !== true) return null
  return (
    <>
      <MenuItemButton
        separatorBefore
        icon={<IconFolderOpenRegular />}
        disabled={pending}
        onSelect={() => { act(reveal) }}
      >
        {props.t('path.reveal')}
      </MenuItemButton>
      {toast}
    </>
  )
}
