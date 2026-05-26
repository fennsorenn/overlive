import type { PlatformAdapter } from './types.js'
import type { Platform } from '../events/types.js'

export class AdapterRegistry {
  private readonly adapters = new Map<Platform, PlatformAdapter>()

  register(adapter: PlatformAdapter): void {
    if (this.adapters.has(adapter.platform)) {
      throw new Error(
        `An adapter for platform "${adapter.platform}" is already registered. ` +
        `Call unregister("${adapter.platform}") first.`,
      )
    }
    this.adapters.set(adapter.platform, adapter)
  }

  unregister(platform: Platform): boolean {
    return this.adapters.delete(platform)
  }

  get(platform: Platform): PlatformAdapter | undefined {
    return this.adapters.get(platform)
  }

  getAll(): PlatformAdapter[] {
    return Array.from(this.adapters.values())
  }

  has(platform: Platform): boolean {
    return this.adapters.has(platform)
  }

  /**
   * Returns the set of platforms currently registered.
   * Used by the suppression engine to know which adapters are present.
   */
  registeredPlatforms(): Set<Platform> {
    return new Set(this.adapters.keys())
  }
}
