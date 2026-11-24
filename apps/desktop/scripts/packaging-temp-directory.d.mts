/** Choose a temporary directory that packaging subprocesses can actually use. */

/** One ordered candidate directory, with the environment name that supplied it. */
export interface PackagingTempCandidate {
  readonly label: string
  readonly directory: string | undefined
}

/** The selected directory and the candidates the probe rejected. */
export interface PackagingTempSelection {
  readonly directory: string
  readonly failures: readonly string[]
}

/**
 * Prove a directory supports the create, enumerate, read, and delete cycle packaging tools need.
 * @param directory Absolute directory path.
 * @returns Failure detail, or `undefined` when packaging can use the directory.
 */
export function temporaryDirectoryFailure(directory: string): string | undefined

/**
 * Select the first candidate whose temporary directory survives the probe.
 * @param candidates Ordered candidates; the caller supplies a final fallback it owns.
 * @returns The usable directory and the rejected candidates.
 * @throws when no candidate is usable.
 */
export function resolvePackagingTempDirectory(candidates: readonly PackagingTempCandidate[]): PackagingTempSelection
