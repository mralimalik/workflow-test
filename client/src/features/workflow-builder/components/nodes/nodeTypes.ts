import { AgentNode } from './AgentNode'
import { EndNode } from './EndNode'
import { RouterNode } from './RouterNode'
import { StartNode } from './StartNode'

export const nodeTypes = {
  start: StartNode,
  agent: AgentNode,
  router: RouterNode,
  end: EndNode,
}
