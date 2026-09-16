import { createEmptyWorkflow } from '@/entities/workflow/model/defaults'
import type { Workflow } from '@/entities/workflow/model/types'
import { networkDelay, readJson, writeJson } from './storage'

const STORAGE_KEY = 'workflow.current'

/**
 * Stands in for `GET/PUT /api/workflow` (single workflow per user).
 * Swap the bodies for `fetch` calls once the Express/Mongo backend exists —
 * every call here is already async and returns the same shapes.
 */
export const workflowRepository = {
  async getCurrent(): Promise<Workflow> {
    await networkDelay()
    return readJson<Workflow | null>(STORAGE_KEY, null) ?? createEmptyWorkflow()
  },

  async saveCurrent(workflow: Workflow): Promise<Workflow> {
    await networkDelay(60)
    const updated: Workflow = { ...workflow, updatedAt: new Date().toISOString() }
    writeJson(STORAGE_KEY, updated)
    return updated
  },

  async reset(): Promise<Workflow> {
    await networkDelay()
    const fresh = createEmptyWorkflow()
    writeJson(STORAGE_KEY, fresh)
    return fresh
  },
}
