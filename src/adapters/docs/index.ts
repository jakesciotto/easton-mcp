import type { Adapter } from '../../mcp/registry.js'
import type { DriveClient } from './drive.js'
import type { DocumentRegistry } from './registry.js'
import { docsList } from './tools/list.js'
import { docsRead } from './tools/read.js'
import { docsSearch } from './tools/search.js'

export interface DocsDeps {
  drive: DriveClient
  registry: DocumentRegistry
}

export function docs(deps: DocsDeps): Adapter {
  return {
    name: 'docs',
    tools: [docsList(deps), docsSearch(deps), docsRead(deps)],
    resources: [],
    health: () =>
      deps.registry.roots().then(
        () => true,
        () => false,
      ),
  }
}
