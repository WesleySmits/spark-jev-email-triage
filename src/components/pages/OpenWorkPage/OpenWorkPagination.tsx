import { Button } from '../../atoms/Button/Button'

type Props = Readonly<{
  hasOlder: boolean
  loading: boolean
  moreLoading: boolean
  moreError: boolean
  onLoadMore: () => void
}>

/** Advances through the local decision record one Spark-checked page at a time. */
export function OpenWorkPagination({
  hasOlder,
  loading,
  moreLoading,
  moreError,
  onLoadMore,
}: Props) {
  if (!hasOlder) return null
  return (
    <div className="open-work__more">
      <Button
        type="button"
        variant="secondary"
        disabled={loading || moreLoading}
        onClick={onLoadMore}
      >
        {moreLoading ? 'Loading older decisions…' : 'Load older decisions'}
      </Button>
      <p>Older local decisions remain available. Each request checks at most 50 copies.</p>
      {moreError && <p role="alert">Older decisions could not be loaded. Try again.</p>}
    </div>
  )
}
