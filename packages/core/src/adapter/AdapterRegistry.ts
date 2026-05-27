import type { PlatformAdapter } from './types.js'
import type { Platform } from '../events/types.js'

export interface RegistryEntry {
  instanceId: string
  adapter: PlatformAdapter
}

/**
 * Registry of adapter instances, keyed by `instanceId`.
 *
 * Multiple instances of the same platform may be registered (e.g. two Twitch
 * accounts), as long as their `instanceId`s differ.
 */
export class AdapterRegistry {
  private readonly byInstance = new Map<string, PlatformAdapter>()

  register(instanceId: string, adapter: PlatformAdapter): void {
    if (this.byInstance.has(instanceId)) {
      throw new Error(
        `An adapter with instanceId "${instanceId}" is already registered. ` +
        `Call unregister("${instanceId}") first.`,
      )
    }
    this.byInstance.set(instanceId, adapter)
  }

  unregister(instanceId: string): boolean {
    return this.byInstance.delete(instanceId)
  }

  get(instanceId: string): PlatformAdapter | undefined {
    return this.byInstance.get(instanceId)
  }

  has(instanceId: string): boolean {
    return this.byInstance.has(instanceId)
  }

  /** All registered adapter instances. */
  getAll(): PlatformAdapter[] {
    return Array.from(this.byInstance.values())
  }

  /** All registry entries (instanceId + adapter). */
  entries(): RegistryEntry[] {
    return Array.from(this.byInstance.entries()).map(([instanceId, adapter]) => ({
      instanceId,
      adapter,
    }))
  }

  /**
   * The set of platforms currently registered (deduped across instances).
   * Used by the suppression engine to know which platforms are present.
   */
  registeredPlatforms(): Set<Platform> {
    const platforms = new Set<Platform>()
    for (const adapter of this.byInstance.values()) {
      platforms.add(adapter.platform)
    }
    return platforms
  }

  /**
   * Returns the first registered instance of the given platform, or undefined.
   * Useful for REST routing when callers don't disambiguate by instanceId.
   */
  firstOfPlatform(platform: Platform): PlatformAdapter | undefined {
    for (const adapter of this.byInstance.values()) {
      if (adapter.platform === platform) return adapter
    }
    return undefined
  }

  /** All adapter instances for the given platform. */
  allOfPlatform(platform: Platform): PlatformAdapter[] {
    return this.getAll().filter((a) => a.platform === platform)
  }
}
