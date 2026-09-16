import type { Tool } from '@/entities/tool/model/types'
import { networkDelay, readJson, writeJson } from './storage'

const STORAGE_KEY = 'tools'

function readAll(): Tool[] {
  return readJson<Tool[]>(STORAGE_KEY, [])
}

/** Stands in for `/api/tools` CRUD endpoints. */
export const toolRepository = {
  async list(): Promise<Tool[]> {
    await networkDelay()
    return readAll()
  },

  async get(id: string): Promise<Tool | undefined> {
    await networkDelay()
    return readAll().find((tool) => tool.id === id)
  },

  async create(tool: Tool): Promise<Tool> {
    await networkDelay(60)
    const all = readAll()
    all.push(tool)
    writeJson(STORAGE_KEY, all)
    return tool
  },

  async update(tool: Tool): Promise<Tool> {
    await networkDelay(60)
    const all = readAll()
    const index = all.findIndex((item) => item.id === tool.id)
    const updated = { ...tool, updatedAt: new Date().toISOString() }
    if (index === -1) {
      all.push(updated)
    } else {
      all[index] = updated
    }
    writeJson(STORAGE_KEY, all)
    return updated
  },

  async remove(id: string): Promise<void> {
    await networkDelay(60)
    writeJson(
      STORAGE_KEY,
      readAll().filter((tool) => tool.id !== id),
    )
  },
}
