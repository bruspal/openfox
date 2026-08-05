import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useSessionStore, useIsRunning } from '../../stores/session'
import { useDisplaySettings } from '../../stores/settings'

import { type TurnStats } from '../../lib/types'
import type { Message } from '@shared/types.js'

import { SessionLayout } from '../layout/SessionLayout'
import { SessionHeader } from './SessionHeader'
import { TurnStatsModal } from './TurnStatsModal'
import { MessageList } from './MessageList'
import { ConnectionStatusBar } from '../shared/ConnectionStatusBar'
import { useAgentsStore } from '../../stores/agents'
import { useCommandsStore } from '../../stores/commands'
import { useWorkflowsStore } from '../../stores/workflows'
import { focusChatTextarea } from '../../lib/focusChatTextarea'
import { CommandsModal } from '../settings/CommandsModal'
import { WorkflowsModal } from '../settings/WorkflowsModal'
import { QuickActionModal } from '../QuickActionModal'
import { MessageSearchModal } from './MessageSearchModal'
import { ChatInput } from './ChatInput'
import { WorkflowParamModal } from './WorkflowParamModal'
import { extractTemplateParams } from '../../lib/parse-slash-command'
import { SidebarSummaryHeader } from './SidebarSummaryHeader'
import { shouldCaptureMessageSearchShortcut } from './message-search-shortcut'

import { groupMessages, type DisplayItem } from './groupMessages.js'
import { FEED_REVEAL_EVENT } from './feed-window'
import { usePromptHistory } from '../../hooks/usePromptHistory.js'
import { useAutoScroll } from '@/hooks/useAutoScroll.ts'
import { useViewport } from '../../hooks/useViewport'
import type { OverlayScrollbarsComponentRef } from 'overlayscrollbars-react'
import { useScrolledSend } from '@/hooks/useScrolledSend.ts'
import { useKeybindings, useBinding, useAgentSwitchingBindings } from '../../hooks/useKeybindings'

interface PlanPanelProps {
  criteriaSidebarOpen?: boolean
  onCriteriaSidebarToggle?: () => void
  rawMessages?: Message[]
  hiddenCount?: number
}

export function PlanPanel({
  criteriaSidebarOpen: externalCriteriaSidebarOpen,
  onCriteriaSidebarToggle,
  rawMessages: propRawMessages,
  hiddenCount: propHiddenCount,
}: PlanPanelProps = {}) {
  const criteriaSidebarOpen = externalCriteriaSidebarOpen ?? true
  const [input, setInput] = useState('')

  const [attachments, setAttachments] = useState<import('@shared/types.js').Attachment[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [showCommandsModal, setShowCommandsModal] = useState(false)
  const [showWorkflowsModal, setShowWorkflowsModal] = useState(false)
  const [showQuickAction, setShowQuickAction] = useState(false)
  const [showMessageSearch, setShowMessageSearch] = useState(false)
  const [turnStatsModal, setTurnStatsModal] = useState<TurnStats | null>(null)
  const scrollContainerRef = useRef<OverlayScrollbarsComponentRef<'div'>>(null)

  const getViewport = useViewport(scrollContainerRef)

  const session = useSessionStore((state) => state.currentSession)
  const storeMessages = useSessionStore((state) => state.messages)
  const storeHiddenCount = useSessionStore((state) => state.hiddenCount)
  const sessions = useSessionStore((state) => state.sessions)
  const isRunning = useIsRunning()
  const stopGeneration = useSessionStore((state) => state.stopGeneration)

  const messages = propRawMessages ?? storeMessages

  const { maxVisibleItems } = useDisplaySettings()

  const agentDefaults = useAgentsStore((state) => state.defaults)
  const agentUserItems = useAgentsStore((state) => state.userItems)
  const topLevelAgents = [...agentDefaults, ...agentUserItems].filter((a) => !a.subagent)

  const { history, selectedIndex, showHistory, openHistory, closeHistory, navigateUp, navigateDown, selectCurrent } =
    usePromptHistory(messages, sessions, session?.id)

  useEffect(() => {
    const handler = (e: Event) => {
      const customEvent = e as CustomEvent<{ stats: TurnStats }>
      setTurnStatsModal(customEvent.detail.stats)
    }
    window.addEventListener('open-turn-stats', handler)
    return () => window.removeEventListener('open-turn-stats', handler)
  }, [])

  // Scope project workflows to the active session's project so project-scoped
  // items are listed, edited, and launched from the correct project.
  const sessionWorkdir = session?.workdir
  useEffect(() => {
    useWorkflowsStore.getState().setWorkdir(sessionWorkdir)
    if (sessionWorkdir) {
      useWorkflowsStore.getState().fetchWorkflows()
    }
  }, [sessionWorkdir])

  useEffect(() => {
    useWorkflowsStore.getState().fetchWorkflows()
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (shouldCaptureMessageSearchShortcut(e)) {
        e.preventDefault()
        setShowMessageSearch(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const previousDisplayItemsRef = useRef<DisplayItem[]>([])

  const { displayItems, hiddenCount: computedHiddenCount } = useMemo((): {
    displayItems: DisplayItem[]
    hiddenCount: number
  } => {
    const items = groupMessages(messages, previousDisplayItemsRef.current)
    previousDisplayItemsRef.current = items
    if (maxVisibleItems > 0 && items.length > maxVisibleItems) {
      return { displayItems: items.slice(-maxVisibleItems), hiddenCount: items.length - maxVisibleItems }
    }
    return { displayItems: items, hiddenCount: 0 }
  }, [messages, maxVisibleItems])

  // The server reports how many messages it trimmed (maxVisibleItems cap); that
  // value lives in the store and is authoritative. The client-side computation
  // below is only a fallback for data that arrived untrimmed (streaming/replay),
  // where the server value would already be reflected or unavailable.
  const hiddenCount = propHiddenCount ?? storeHiddenCount ?? computedHiddenCount

  const { isAutoScrollActive, setAutoScroll, handleScrollbarGesture } = useAutoScroll(
    scrollContainerRef,
    session,
    getViewport,
  )
  const { sendMessage, launchWorkflow } = useScrolledSend(setAutoScroll)
  const [pendingParamWorkflow, setPendingParamWorkflow] = useState<{
    id: string
    name: string
    subGroup?: string
  } | null>(null)
  const [pendingCommandParams, setPendingCommandParams] = useState<{
    prompt: string
    paramKeys: string[]
    agentMode?: string
    textareaContent?: string
    attachments?: import('@shared/types.js').Attachment[]
  } | null>(null)

  const launchOrShowParams = useCallback(
    (workflowId: string, subGroup?: string, extraParams?: Record<string, string>) => {
      const allWorkflows = useWorkflowsStore.getState()
      const workflows = [...allWorkflows.defaults, ...allWorkflows.userItems, ...allWorkflows.projectItems]
      const wf = workflows.find((w) => w.id === workflowId)
      const params = (wf?.parameters ?? []).filter((p) => p.position !== undefined || p.required)
      if (params.length > 0) {
        setPendingParamWorkflow({ id: workflowId, name: wf?.name ?? workflowId, subGroup })
      } else {
        launchWorkflow(undefined, undefined, workflowId, subGroup, extraParams)
      }
    },
    [launchWorkflow],
  )

  const handleLaunchWorkflow = useCallback(
    (workflowId: string, subGroup?: string, params?: Record<string, string>) => {
      launchOrShowParams(workflowId, subGroup, params)
    },
    [launchOrShowParams],
  )

  const handleTimelineNavigate = useCallback(
    (index: number) => {
      setAutoScroll(false)
      const element = document.querySelector(`[data-item-index="${index}"]`)
      if (element) {
        if (element.hasAttribute('data-placeholder')) {
          window.dispatchEvent(new CustomEvent(FEED_REVEAL_EVENT, { detail: { index } }))
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              document
                .querySelector(`[data-item-index="${index}"]`)
                ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }),
          )
        } else {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      }
    },
    [setAutoScroll],
  )

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      const popupOpen =
        showQuickAction || showCommandsModal || showWorkflowsModal || showMessageSearch || turnStatsModal
      if (e.key === 'Escape' && isRunning && !popupOpen) {
        stopGeneration()
      }
      if (e.key === 'ScrollLock') {
        setAutoScroll(!isAutoScrollActive)
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [
    isRunning,
    stopGeneration,
    isAutoScrollActive,
    showQuickAction,
    showCommandsModal,
    showWorkflowsModal,
    showMessageSearch,
    turnStatsModal,
  ])

  const keybindings = useKeybindings()
  useBinding(keybindings.quickAction, () => {
    setShowQuickAction(true)
  })

  useBinding(keybindings.criteriaSidebar, () => {
    onCriteriaSidebarToggle?.()
  })

  useAgentSwitchingBindings(keybindings.agentSwitching, topLevelAgents, (agentId) => {
    useSessionStore.getState().switchMode(agentId)
  })

  const handleSelectWorkflow = (workflowId: string) => {
    launchOrShowParams(workflowId)
    clearInput()
  }

  const handleSelectWorkflowWithSubGroup = (workflowId: string, subGroup: string) => {
    launchOrShowParams(workflowId, subGroup)
    clearInput()
  }

  const clearInput = () => {
    setInput('')
    setAttachments([])
    if (session?.id) {
      localStorage.removeItem(`openfox:draft:${session.id}`)
    }
  }

  const handleSendCommand = useCallback(
    async (
      content: string,
      agentMode?: string,
      textareaContent?: string,
      attachments?: import('@shared/types.js').Attachment[],
    ) => {
      const paramKeys = extractTemplateParams(content)
      if (paramKeys.length > 0) {
        setPendingCommandParams({ prompt: content, paramKeys, agentMode, textareaContent, attachments })
      } else {
        if (agentMode && session?.mode !== agentMode) {
          await useSessionStore.getState().switchMode(agentMode)
        }
        const combinedContent =
          textareaContent && textareaContent.trim() ? `${textareaContent.trim()}\n\n${content}` : content
        sendMessage(combinedContent, attachments?.length ? attachments : undefined, {
          messageKind: 'command',
          isSystemGenerated: true,
        })
        clearInput()
      }
    },
    [sendMessage, clearInput, session],
  )

  return (
    <>
      <SessionLayout
        criteriaSidebarOpen={criteriaSidebarOpen}
        onCriteriaSidebarToggle={onCriteriaSidebarToggle}
        messages={messages}
      >
        <SidebarSummaryHeader visible={!criteriaSidebarOpen} />

        <SessionHeader />

        {turnStatsModal && <TurnStatsModal stats={turnStatsModal} onClose={() => setTurnStatsModal(null)} />}
        <ConnectionStatusBar />

        <MessageList
          displayItems={displayItems}
          scrollContainerRef={scrollContainerRef}
          // Highlight is intentionally wired to the timeline's FEED_REVEAL_EVENT:
          // navigation reveals the target placeholder region before scrolling,
          // so no highlight target is ever an unmounted item. Passing null here
          // keeps the highlight path dead until a caller reveals first.
          highlightedMessageId={null}
          onLaunchWorkflow={handleLaunchWorkflow}
          onScrollToTop={() => setAutoScroll(false)}
          hiddenCount={hiddenCount}
          onScrollbarGesture={handleScrollbarGesture}
        />

        <ChatInput
          input={input}
          setInput={setInput}
          attachments={attachments}
          setAttachments={setAttachments}
          dragOver={dragOver}
          setDragOver={setDragOver}
          errorMessage={errorMessage}
          setErrorMessage={setErrorMessage}
          scrollToBottom={() => getViewport()?.scrollTo({ top: getViewport()?.scrollHeight ?? 0, behavior: 'smooth' })}
          sessionId={session?.id}
          showHistory={showHistory}
          history={history}
          selectedIndex={selectedIndex}
          openHistory={openHistory}
          closeHistory={closeHistory}
          navigateUp={navigateUp}
          navigateDown={navigateDown}
          selectCurrent={selectCurrent}
          isAutoScrollActive={isAutoScrollActive}
          setAutoScroll={setAutoScroll}
          onOpenMessageSearch={() => setShowMessageSearch(true)}
          onOpenCommandsModal={() => setShowCommandsModal(true)}
          onOpenWorkflowsModal={() => setShowWorkflowsModal(true)}
          onSelectWorkflow={handleSelectWorkflow}
          onSelectWorkflowWithSubGroup={handleSelectWorkflowWithSubGroup}
          onSendCommand={handleSendCommand}
          clearInput={clearInput}
        />
        <CommandsModal isOpen={showCommandsModal} onClose={() => setShowCommandsModal(false)} />
        <WorkflowsModal
          isOpen={showWorkflowsModal}
          onClose={() => setShowWorkflowsModal(false)}
          projectDir={session?.workdir}
        />
        <QuickActionModal
          isOpen={showQuickAction}
          onClose={() => setShowQuickAction(false)}
          onSearchMessages={() => setShowMessageSearch(true)}
          isAutoScrollActive={isAutoScrollActive}
          onToggleAutoScroll={setAutoScroll}
          textareaContent={input}
          onCloseComplete={focusChatTextarea}
          onCloseCompleteAction={() => window.dispatchEvent(new CustomEvent('open-session-dropdown'))}
          onSelectCommand={async (commandId, textareaContent) => {
            const full = await useCommandsStore.getState().fetchCommand(commandId)
            if (full) {
              handleSendCommand(full.prompt, full.metadata.agentMode, textareaContent)
            }
          }}
          onSelectWorkflow={(workflowId) => {
            launchOrShowParams(workflowId)
            clearInput()
          }}
        />

        {pendingParamWorkflow && (
          <WorkflowParamModal
            workflowName={pendingParamWorkflow.name}
            parameters={(() => {
              const allWf = useWorkflowsStore.getState()
              const all = [...allWf.defaults, ...allWf.userItems, ...allWf.projectItems]
              return all.find((w) => w.id === pendingParamWorkflow.id)?.parameters ?? []
            })()}
            onConfirm={(params) => {
              launchWorkflow(undefined, undefined, pendingParamWorkflow.id, pendingParamWorkflow.subGroup, params)
              setPendingParamWorkflow(null)
            }}
            onCancel={() => setPendingParamWorkflow(null)}
          />
        )}

        {pendingCommandParams && (
          <WorkflowParamModal
            workflowName="Command"
            confirmLabel="Launch command"
            parameters={pendingCommandParams.paramKeys.map((key, i) => ({
              id: key,
              label: key,
              position: i,
            }))}
            onConfirm={(params) => {
              let prompt = pendingCommandParams.prompt
              for (const [key, value] of Object.entries(params)) {
                prompt = prompt.replaceAll(`{{${key}}}`, value)
              }
              const { agentMode, textareaContent, attachments } = pendingCommandParams
              if (agentMode && session?.mode !== agentMode) {
                useSessionStore.getState().switchMode(agentMode)
              }
              const combinedContent =
                textareaContent && textareaContent.trim() ? `${textareaContent.trim()}\n\n${prompt}` : prompt
              sendMessage(combinedContent, attachments?.length ? attachments : undefined, {
                messageKind: 'command',
                isSystemGenerated: true,
              })
              clearInput()
              setPendingCommandParams(null)
            }}
            onCancel={() => setPendingCommandParams(null)}
          />
        )}
      </SessionLayout>

      {showMessageSearch && (
        <MessageSearchModal
          isOpen={showMessageSearch}
          onClose={() => {
            setShowMessageSearch(false)
            focusChatTextarea(true)
          }}
          displayItems={displayItems}
          onNavigate={handleTimelineNavigate}
        />
      )}
    </>
  )
}

export { VisionFallbackItem } from './VisionFallbackItem'
