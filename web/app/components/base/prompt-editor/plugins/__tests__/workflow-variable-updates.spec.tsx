import type { LexicalEditor } from 'lexical'
import type { UpdateWorkflowNodesMapPayload } from '../workflow-variable-block'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReactFlowProvider } from 'reactflow'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { HITLInputNode } from '../hitl-input-block/node'
import HITLInputVariableBlockComponent from '../hitl-input-block/variable-block'
import { UPDATE_WORKFLOW_NODES_MAP } from '../workflow-variable-block'
import WorkflowVariableBlockComponent from '../workflow-variable-block/component'
import { WorkflowVariableBlockNode } from '../workflow-variable-block/node'
import { CaptureEditorPlugin } from './test-utils'

const fields = ['file_name', 'markdown', 'processing_status', 'summary']

const createUpdate = (title: string): UpdateWorkflowNodesMapPayload => ({
  workflowNodesMap: {
    tool: {
      title,
      type: BlockEnum.Tool,
      width: 200,
      height: 100,
      position: { x: 0, y: 0 },
    },
  },
  availableVariables: [
    {
      nodeId: 'tool',
      title,
      vars: fields.map((variable) => ({ variable, type: VarType.string })),
    },
  ],
})

describe('Workflow variable updates', () => {
  it.each([
    ['workflow', 'hitl', 'workflow', 'hitl'],
    ['hitl', 'workflow', 'hitl', 'workflow'],
  ])('refreshes all prompt blocks when %s registers first', async (...blockTypes) => {
    const user = userEvent.setup()
    const queryClient = createConsoleQueryClient()
    queryClient.setQueryData(
      consoleQuery.workspaces.current.modelProviders.summary.get.queryKey(),
      {
        data: [],
        plugins: {},
      },
    )
    let editor: LexicalEditor | undefined

    renderWithConsoleQuery(
      <ReactFlowProvider>
        <LexicalComposer
          initialConfig={{
            namespace: 'workflow-variable-updates',
            onError: (error: Error) => {
              throw error
            },
            nodes: [WorkflowVariableBlockNode, HITLInputNode],
          }}
        >
          {blockTypes.map((type, index) =>
            type === 'workflow' ? (
              <WorkflowVariableBlockComponent
                key={fields[index]}
                nodeKey={`variable-${index}`}
                variables={['tool', fields[index]!]}
                workflowNodesMap={{}}
              />
            ) : (
              <HITLInputVariableBlockComponent
                key={fields[index]}
                variables={['tool', fields[index]!]}
                workflowNodesMap={{}}
              />
            ),
          )}
          <CaptureEditorPlugin
            onReady={(value) => {
              editor = value
            }}
          />
        </LexicalComposer>
      </ReactFlowProvider>,
      { queryClient },
    )

    const lastWorkflowField = fields[blockTypes.lastIndexOf('workflow')]!
    await user.hover(screen.getByText(lastWorkflowField))
    expect(await screen.findByText('workflow.errorMsg.invalidVariable')).toBeVisible()

    act(() => {
      editor!.dispatchCommand(UPDATE_WORKFLOW_NODES_MAP, createUpdate('Tool outputs'))
    })

    await waitFor(() => {
      expect(screen.getAllByText('Tool outputs')).toHaveLength(fields.length)
      expect(screen.queryByText('workflow.errorMsg.invalidVariable')).not.toBeInTheDocument()
    })

    await user.unhover(screen.getByText(lastWorkflowField))
    act(() => {
      editor!.dispatchCommand(UPDATE_WORKFLOW_NODES_MAP, {
        ...createUpdate('Renamed tool'),
        availableVariables: [],
      })
    })

    await waitFor(() => {
      expect(screen.getAllByText('Renamed tool')).toHaveLength(fields.length)
    })
    await user.hover(screen.getByText(lastWorkflowField))
    expect(await screen.findByText('workflow.errorMsg.invalidVariable')).toBeVisible()
  })
})
