import { useCallback, useState } from 'react'
import { useChatStore } from '@/entities/chat/model/chatStore'
import { useRunStore } from '@/entities/run/model/runStore'
import { isAzureSettingsConfigured } from '@/entities/settings/model/types'
import { useCanvasStore } from '@/entities/workflow/model/canvasStore'
import { useAzureSettings } from '@/features/settings/hooks/useSettings'
import { useTools } from '@/features/tools/hooks/useTools'
import { runWorkflow } from '@/features/workflow-runner/engine/graphExecutor'

export function useChatRunner() {
  const getSnapshot = useCanvasStore((state) => state.getSnapshot)
  const messages = useChatStore((state) => state.messages)
  const addMessage = useChatStore((state) => state.addMessage)
  const pushMessage = useChatStore((state) => state.pushMessage)
  const clearChat = useChatStore((state) => state.clear)
  const { data: tools } = useTools()
  const { data: settings } = useAzureSettings()
  const runStart = useRunStore((state) => state.start)
  const runFinish = useRunStore((state) => state.finish)
  const runReset = useRunStore((state) => state.reset)
  const setActiveNode = useRunStore((state) => state.setActiveNode)
  const pushStep = useRunStore((state) => state.pushStep)
  const updateStep = useRunStore((state) => state.updateStep)
  const [isRunning, setIsRunning] = useState(false)

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || isRunning) return

      if (!settings || !isAzureSettingsConfigured(settings)) {
        addMessage({
          role: 'system',
          content: 'Add your Azure OpenAI endpoint, API key and deployment in Settings before running the workflow.',
        })
        return
      }

      const workflow = getSnapshot()
      const userMessage = addMessage({ role: 'user', content: trimmed })

      setIsRunning(true)
      runStart()

      let currentStepId = ''

      const result = await runWorkflow(
        {
          workflow,
          tools: tools ?? [],
          settings,
          history: [...messages, userMessage],
        },
        {
          onNodeEnter: (node) => {
            setActiveNode(node.id)
            currentStepId = pushStep({ nodeId: node.id, nodeLabel: node.data.label, status: 'active' })
          },
          onNodeExit: (_node, status, detail) => {
            if (currentStepId) updateStep(currentStepId, { status, detail })
          },
          onMessage: (message) => pushMessage(message),
        },
      )

      setIsRunning(false)
      runFinish(result.status)
      if (result.status === 'error' && result.error) {
        addMessage({ role: 'system', content: `⚠️ ${result.error}` })
      }
    },
    [isRunning, settings, getSnapshot, addMessage, runStart, tools, messages, setActiveNode, pushStep, updateStep, pushMessage, runFinish],
  )

  const reset = useCallback(() => {
    clearChat()
    runReset()
  }, [clearChat, runReset])

  return { messages, isRunning, send, reset }
}
