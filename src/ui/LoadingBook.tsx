import type { LoadProgress, LoadStage } from '../engine/types'

/** What each stage is called, in words a parent would use. */
const LABELS: Record<LoadStage, string> = {
  reading: 'Reading the file',
  unpacking: 'Unpacking the book',
  inspecting: 'Looking at what is inside',
  measuring: 'Measuring the pages',
  pairing: 'Working out the spreads',
  saving: 'Saving it to your shelf',
}

/** The order they happen in, so the list reads as a journey rather than a flicker. */
const ORDER: LoadStage[] = ['reading', 'unpacking', 'inspecting', 'measuring', 'pairing', 'saving']

export interface BookLoading {
  title: string
  progress: LoadProgress
  /** Set while importing a folder: which book of how many. */
  batch?: { done: number; total: number }
}

/**
 * What the reader is doing while a book opens.
 *
 * A picture book is not quick to open — a hundred-page fixed-layout book has every
 * page read and, where a page declares no size of its own, an image header decoded
 * as well. Before this, all of that happened behind a book title and the word
 * "Opening", so a slow book and a frozen app looked identical, and the only way to
 * tell them apart was to wait and find out.
 *
 * Showing the stages is the honest version: something is always moving, and when the
 * work is countable the bar says how much is left rather than spinning to no purpose.
 */
export function LoadingBook({ loading }: { loading: BookLoading }) {
  const { stage, done, total } = loading.progress
  const countable = total !== undefined && total > 0 && done !== undefined
  const percent = countable ? Math.round((done / total) * 100) : 0
  const reached = ORDER.indexOf(stage)

  return (
    <div className="loading-backdrop" role="dialog" aria-modal="true" aria-labelledby="loading-title">
      <div className="loading-card">
        {loading.batch && (
          <p className="loading-batch">
            Adding book {loading.batch.done + 1} of {loading.batch.total}
          </p>
        )}
        <p className="loading-book" id="loading-title">
          {loading.title}
        </p>

        {/* A live region, so a screen reader hears the stage change rather than
            being told once that something is loading and then left in silence. */}
        <p className="loading-stage" aria-live="polite">
          {LABELS[stage]}
          {countable && <span className="muted"> · {done} of {total} pages</span>}
        </p>

        <div
          className="loading-track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          // Omitted entirely while the work is uncountable: an indeterminate bar
          // that reports a number is lying about knowing.
          aria-valuenow={countable ? percent : undefined}
          aria-valuetext={countable ? `${percent}%` : LABELS[stage]}
        >
          <div
            className={`loading-fill${countable ? '' : ' loading-fill-sweep'}`}
            style={countable ? { width: `${percent}%` } : undefined}
          />
        </div>

        <ol className="loading-steps">
          {ORDER.map((step, i) => (
            <li
              key={step}
              className={i < reached ? 'step-done' : i === reached ? 'step-now' : 'step-todo'}
            >
              {LABELS[step]}
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
