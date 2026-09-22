import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import {
  completeDemoMessage,
  demoMailboxes,
  demoMessages,
  demoTopBar,
  demoWorkflows,
  loadDemoBody,
} from '../app/demo'
import { WorkbenchPage } from '../components/pages/WorkbenchPage/WorkbenchPage'

export const Route = createFileRoute('/')({
  component: Home,
})

// A demo on fictional sample data. Bodies load one at a time when a message
// opens. Complete changes this page's state only: nothing is written and no
// mailbox changes.
function Home() {
  const [messages, setMessages] = useState(demoMessages)
  return (
    <div className="app-root">
      <WorkbenchPage
        messages={messages}
        loadBody={loadDemoBody}
        workflows={demoWorkflows}
        mailboxes={demoMailboxes}
        completion={{
          mode: 'enabled',
          onComplete: (id) => {
            setMessages((current) => completeDemoMessage(current, id))
          },
        }}
        topBar={{ ...demoTopBar, onSyncClick: () => undefined }}
      />
    </div>
  )
}
