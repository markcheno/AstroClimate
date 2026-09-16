import { useEffect, useRef, useState } from 'react'
import { searchPlaces } from '../climatology/geocode'
import type { Place } from '../climatology/place'

interface Props {
  saved: Place[]
  selected: Place | null
  onSelect: (place: Place) => void
}

/**
 * Pick a saved location, or search for anywhere on Earth.
 *
 * Saved places have thirty years of climatology behind them; searched ones get
 * astronomy and tonight's forecast. The list says which is which up front,
 * rather than letting someone pick a place and then discover half the app is
 * missing.
 */
export function LocationSearch({ saved, selected, onSelect }: Props) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<Place[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (query.trim().length < 2) {
      setHits([])
      setError(null)
      return
    }
    const controller = new AbortController()
    // Debounced: the geocoder is a shared free service, not something to hit on
    // every keystroke.
    const timer = setTimeout(() => {
      setBusy(true)
      searchPlaces(query, controller.signal)
        .then((results) => {
          setHits(results)
          setError(results.length ? null : 'No matches')
        })
        .catch((e: Error) => {
          if (e.name !== 'AbortError') setError(e.message)
        })
        .finally(() => setBusy(false))
    }, 300)

    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [query])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const choose = (place: Place) => {
    onSelect(place)
    setQuery('')
    setHits([])
    setOpen(false)
  }

  return (
    <div className="location-search" ref={boxRef}>
      <label htmlFor="place-search">Location</label>
      <input
        id="place-search"
        type="search"
        value={query}
        placeholder={selected ? selected.name : 'Search any town or postal code'}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        autoComplete="off"
      />

      {open && (
        <div className="search-results" role="listbox">
          {saved.length > 0 && query.trim().length < 2 && (
            <>
              <p className="search-group">Saved locations · full history</p>
              {saved.map((place) => (
                <button
                  key={place.id}
                  type="button"
                  role="option"
                  aria-selected={selected?.id === place.id}
                  className="search-hit"
                  onClick={() => choose(place)}
                >
                  <span>{place.name}</span>
                  <span className="hit-badge">30 yr</span>
                </button>
              ))}
              <p className="search-group">Or search anywhere on Earth</p>
            </>
          )}

          {busy && <p className="search-note">Searching…</p>}
          {error && !busy && <p className="search-note">{error}</p>}

          {hits.map((place) => (
            <button
              key={place.id}
              type="button"
              role="option"
              aria-selected={selected?.id === place.id}
              className="search-hit"
              onClick={() => choose(place)}
            >
              <span>
                {place.name}
                {place.detail && <small> {place.detail}</small>}
              </span>
              <span className="hit-badge muted">tonight only</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
