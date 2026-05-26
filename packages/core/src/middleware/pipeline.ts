import type { OverliveEvent } from '../events/types.js'

export type MiddlewareNext = (event: OverliveEvent) => Promise<void>
export type Middleware = (event: OverliveEvent, next: MiddlewareNext) => Promise<void>

/**
 * Composable middleware pipeline. Middleware runs in registration order.
 * Each middleware must call `next(event)` to pass the event downstream,
 * or drop it by simply not calling next.
 */
export class MiddlewarePipeline {
  private readonly stack: Middleware[] = []

  use(middleware: Middleware): this {
    this.stack.push(middleware)
    return this
  }

  async run(event: OverliveEvent, final: MiddlewareNext): Promise<void> {
    const dispatch = async (index: number, evt: OverliveEvent): Promise<void> => {
      if (index >= this.stack.length) {
        await final(evt)
        return
      }
      const middleware = this.stack[index]!
      await middleware(evt, (next) => dispatch(index + 1, next))
    }

    await dispatch(0, event)
  }
}

// ─── Built-in middleware ──────────────────────────────────────────────────────

/**
 * Suppression middleware. Drops events from an adapter if a higher-priority
 * adapter for the same event type is registered.
 *
 * Built into the SDK core — consumers don't need to configure this.
 */
export function createSuppressionMiddleware(
  getRegisteredPlatforms: () => Set<string>,
  getAdapterSuppressionMap: (platform: string) => Partial<Record<string, string[]>>,
): Middleware {
  return async (event, next) => {
    const suppressedBy = getAdapterSuppressionMap(event.platform)
    const supersedingPlatforms = suppressedBy[event.type]

    if (supersedingPlatforms && supersedingPlatforms.length > 0) {
      const registered = getRegisteredPlatforms()
      const shouldSuppress = supersedingPlatforms.some((p) => registered.has(p))
      if (shouldSuppress) return // drop — higher priority adapter will emit this
    }

    await next(event)
  }
}

/**
 * Logging middleware. Useful during development.
 */
export function createLoggingMiddleware(
  logger: (msg: string, event: OverliveEvent) => void = (msg) => console.log(msg),
): Middleware {
  return async (event, next) => {
    logger(`[overlive] ${event.platform} → ${event.type} (${event.channel})`, event)
    await next(event)
  }
}
