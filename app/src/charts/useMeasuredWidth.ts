import { useEffect, useState, type RefObject } from 'react'

/**
 * Track an element's rendered width so charts can draw at 1:1 pixels.
 *
 * Scaling a fixed viewBox would be less code, but it shrinks the axis text
 * along with everything else, and at 390px the labels stop being readable.
 */
export function useMeasuredWidth(ref: RefObject<HTMLElement | null>, fallback = 720): number {
  const [width, setWidth] = useState(fallback)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setWidth(Math.max(240, Math.round(entry.contentRect.width)))
    })
    observer.observe(element)
    setWidth(Math.max(240, Math.round(element.getBoundingClientRect().width)))
    return () => observer.disconnect()
  }, [ref])

  return width
}
