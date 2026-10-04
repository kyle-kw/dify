import type { PropsWithChildren } from 'react'
import type { FileEntity } from '../types'
import type { FileUpload } from '@/app/components/base/features/types'
import { act, renderHook } from '@testing-library/react'
import { TransferMethod } from '@/types/app'
import { useFile } from '../hooks'
import { createFileStore, FileContext } from '../store'

const mocks = vi.hoisted(() => ({
  fileUpload: vi.fn(),
  uploadRemoteFileInfo: vi.fn(),
}))

vi.mock('@/next/navigation', () => ({
  useParams: () => ({}),
  usePathname: () => '/chat',
}))

vi.mock('../utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils')>()),
  fileUpload: mocks.fileUpload,
}))

vi.mock('@/service/common', () => ({
  uploadRemoteFileInfo: mocks.uploadRemoteFileInfo,
}))

vi.mock('@/service/share', () => ({
  uploadHumanInputFormLocalFile: vi.fn(),
  uploadHumanInputFormRemoteFileInfo: vi.fn(),
}))

vi.mock('@/app/notifications', () => ({
  toast: { error: vi.fn() },
}))

const existingFile: FileEntity = {
  id: 'existing-file',
  name: 'existing.png',
  type: 'image/png',
  size: 4,
  progress: 100,
  transferMethod: TransferMethod.local_file,
  supportFileType: 'image',
  originalFile: new File(['image'], 'existing.png', { type: 'image/png' }),
}

const renderUploader = (numberLimits: number | undefined, files: FileEntity[] = []) => {
  const store = createFileStore(files)
  const config: FileUpload = {
    enabled: true,
    number_limits: numberLimits,
    allowed_file_types: ['image'],
  }
  const wrapper = ({ children }: PropsWithChildren) => (
    <FileContext value={store}>{children}</FileContext>
  )
  const hook = renderHook(() => ({ first: useFile(config), second: useFile(config) }), { wrapper })
  return { ...hook, store }
}

// Hold file reads until all upload entry points have run, as can happen when
// multiple controls share the uploader's store before FileReader completes.
let finishReads: (() => void)[] = []
class DeferredFileReader extends EventTarget {
  result = 'data:image/png;base64,aW1hZ2U='

  readAsDataURL() {
    finishReads.push(() => this.dispatchEvent(new ProgressEvent('load')))
  }
}

const imageFile = (name: string) => new File(['image'], name, { type: 'image/png' })

beforeEach(() => {
  vi.clearAllMocks()
  finishReads = []
  vi.stubGlobal('FileReader', DeferredFileReader)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('file upload count limit', () => {
  it.each(['paste', 'drop'] as const)('ignores a %s upload when the store is full', (method) => {
    const { result, store } = renderUploader(1, [existingFile])
    const file = imageFile('extra.png')

    act(() => {
      if (method === 'paste') {
        result.current.first.handleClipboardPasteFile({
          clipboardData: { files: [file], getData: () => '' },
          preventDefault: vi.fn(),
        } as unknown as React.ClipboardEvent<HTMLTextAreaElement>)
      } else {
        result.current.first.handleDropFile({
          dataTransfer: { files: [file] },
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
        } as unknown as React.DragEvent<HTMLElement>)
      }
      finishReads.forEach((finish) => finish())
    })

    expect(store.getState().files).toEqual([existingFile])
    expect(mocks.fileUpload).not.toHaveBeenCalled()
  })

  it('shares the remaining slots across consumers when file reads finish together', () => {
    const { result, store } = renderUploader(2)

    act(() => {
      result.current.first.handleLocalFileUpload(imageFile('first.png'))
      result.current.second.handleLocalFileUpload(imageFile('second.png'))
      result.current.first.handleLocalFileUpload(imageFile('extra.png'))
      finishReads.forEach((finish) => finish())
    })

    expect(store.getState().files.map((file) => file.name)).toEqual(['first.png', 'second.png'])
    expect(mocks.fileUpload).toHaveBeenCalledTimes(2)
  })

  it('does not fetch a remote file when the store is full', () => {
    vi.useFakeTimers()
    const { result, store } = renderUploader(1, [existingFile])
    mocks.uploadRemoteFileInfo.mockReturnValue(new Promise(() => {}))

    act(() => {
      result.current.first.handleLoadFileFromLink('https://example.com/extra.png')
    })

    expect(store.getState().files).toEqual([existingFile])
    expect(mocks.uploadRemoteFileInfo).not.toHaveBeenCalled()
  })

  it('counts remote uploads while a local file is still being read', () => {
    vi.useFakeTimers()
    const { result, store } = renderUploader(1)
    mocks.uploadRemoteFileInfo.mockReturnValue(new Promise(() => {}))

    act(() => {
      result.current.first.handleLocalFileUpload(imageFile('local.png'))
      result.current.second.handleLoadFileFromLink('https://example.com/remote.png')
      finishReads.forEach((finish) => finish())
    })

    expect(store.getState().files.map((file) => file.name)).toEqual([
      'https://example.com/remote.png',
    ])
    expect(mocks.uploadRemoteFileInfo).toHaveBeenCalledTimes(1)
    expect(mocks.fileUpload).not.toHaveBeenCalled()
  })

  it('allows retries at the limit and accepts a new file after removing one', () => {
    const { result, store } = renderUploader(1, [{ ...existingFile, progress: -1 }])

    act(() => {
      result.current.first.handleReUploadFile(existingFile.id)
    })
    expect(mocks.fileUpload).toHaveBeenCalledTimes(1)
    expect(store.getState().files).toHaveLength(1)

    act(() => {
      result.current.first.handleRemoveFile(existingFile.id)
      result.current.second.handleLocalFileUpload(imageFile('replacement.png'))
      finishReads.forEach((finish) => finish())
    })

    expect(store.getState().files.map((file) => file.name)).toEqual(['replacement.png'])
    expect(mocks.fileUpload).toHaveBeenCalledTimes(2)
  })

  it.each([undefined, 0])('preserves uploads without an active limit (%s)', (limit) => {
    const { result, store } = renderUploader(limit)

    act(() => {
      result.current.first.handleLocalFileUpload(imageFile('first.png'))
      result.current.second.handleLocalFileUpload(imageFile('second.png'))
      finishReads.forEach((finish) => finish())
    })

    expect(store.getState().files).toHaveLength(2)
    expect(mocks.fileUpload).toHaveBeenCalledTimes(2)
  })
})
