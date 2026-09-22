import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import {
  completeDemoMessage,
  demoMailboxes,
  demoMessages,
  demoTopBar,
  demoWorkflows,
} from '../app/demo'
import { WorkbenchPage } from '../components/pages/WorkbenchPage/WorkbenchPage'

export const Route = createFileRoute('/')({
  component: Home,
})

// A demo on fictional sample data. Complete changes this page's state only:
// nothing is written and no mailbox changes.
function Home() {
  const [messages, setMessages] = useState(demoMessages)
  return (
    <div className="app-root">
      <WorkbenchPage
        messages={messages}
        workflows={demoWorkflows}
        mailboxes={demoMailboxes}
        onComplete={(id) => {
          setMessages((current) => completeDemoMessage(current, id))
        }}
        topBar={{ ...demoTopBar, onSyncClick: () => undefined }}
      />
    </div>
  )
}
