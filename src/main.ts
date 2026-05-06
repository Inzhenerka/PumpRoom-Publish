import * as core from '@actions/core'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import AdmZip from 'adm-zip'

const VALIDATE_URL =
  'https://pumproom-api.inzhenerka-cloud.com/inzhenerka_schema'
const UPLOAD_URL = 'https://pumproom-api.inzhenerka-cloud.com/repo/upload_tasks'

export interface PumpRoomApiResponse {
  pushed_at: string
  tasks_uploaded: number
  tasks_created: number
  tasks_updated: number
  tasks_deleted: number
  tasks_retained: number
}

export function formatPumpRoomResponse(response: PumpRoomApiResponse): string {
  const formattedDate = new Date(response.pushed_at).toLocaleString()
  return `
📊 PumpRoom Repository Update Summary:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🕒 Pushed At: ${formattedDate}

📋 Tasks Summary:
  • Uploaded: ${response.tasks_uploaded}
  • Created: ${response.tasks_created}
  • Updated: ${response.tasks_updated}
  • Deleted: ${response.tasks_deleted}
  • Retained: ${response.tasks_retained}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function postWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

export async function validateUniqueFolderNames(
  rootDir: string
): Promise<void> {
  core.info('🔍 Validating unique folder names...')

  const folders = fs
    .readdirSync(rootDir)
    .filter((item) => fs.statSync(path.join(rootDir, item)).isDirectory())

  if (folders.length === 0) {
    core.info('ℹ️ No folders found to validate')
    return
  }

  const seen = new Map<string, string>()
  const duplicates = new Map<string, string[]>()
  for (const folder of folders) {
    const key = folder.toLowerCase()
    const existing = seen.get(key)
    if (existing === undefined) {
      seen.set(key, folder)
    } else {
      const variants = duplicates.get(key) ?? [existing]
      variants.push(folder)
      duplicates.set(key, variants)
    }
  }

  if (duplicates.size > 0) {
    let errorMessage = '❌ Folder duplicates found:\n'
    for (const [key, variants] of duplicates) {
      errorMessage += `  • ${key} (variants: ${variants.join(', ')})\n`
    }
    throw new Error(errorMessage)
  }

  core.info('✅ No folder duplicates found')
}

export async function validateInzhenerkaYml(rootDir: string): Promise<void> {
  core.info('🔍 Validating .inzhenerka.yml...')

  const configPath = path.join(rootDir, '.inzhenerka.yml')
  if (!fs.existsSync(configPath)) {
    throw new Error('❌ .inzhenerka.yml file not found')
  }

  const configContent = fs.readFileSync(configPath, 'utf8')

  let response: Response
  try {
    response = await postWithTimeout(
      VALIDATE_URL,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config_yml: configContent })
      },
      60_000
    )
  } catch (error) {
    throw new Error(
      `❌ Configuration validation failed:\nError: ${toErrorMessage(error)}\n`
    )
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(
      `❌ Configuration validation failed:\nStatus code: ${response.status}\nResponse: ${body}\n`
    )
  }

  core.info('✅ Configuration is valid')
}

export async function run(): Promise<void> {
  try {
    const rootDir = core.getInput('root_dir') || process.cwd()
    const ignoreInput = core.getInput('ignore') || ''
    const realm = core.getInput('realm')
    const repoName = core.getInput('repo_name')
    const apiKey = core.getInput('api_key')

    const ignoreList = ['.git', '.github']
    if (ignoreInput) {
      ignoreList.push(...ignoreInput.split(',').map((item) => item.trim()))
    }

    core.debug(`Root directory: ${rootDir}`)
    core.debug(`Ignore list: ${ignoreList.join(', ')}`)

    await validateUniqueFolderNames(rootDir)
    await validateInzhenerkaYml(rootDir)

    const tempZipPath = path.join(
      os.tmpdir(),
      `pumproom-${Date.now()}-${process.pid}.zip`
    )
    try {
      await createZipArchive(rootDir, tempZipPath, ignoreList)
      await uploadArchive(tempZipPath, realm, repoName, apiKey)
    } finally {
      if (fs.existsSync(tempZipPath)) {
        try {
          fs.unlinkSync(tempZipPath)
        } catch {
          // best-effort cleanup
        }
      }
    }

    core.info('✅ Repository successfully published to PumpRoom')
  } catch (error) {
    core.setFailed(toErrorMessage(error))
  }
}

export async function createZipArchive(
  sourceDir: string,
  outputPath: string,
  ignoreList: string[]
): Promise<void> {
  core.info('Creating ZIP archive...')

  const zip = new AdmZip()

  function addFilesToZip(currentPath: string, relativePath: string = ''): void {
    for (const item of fs.readdirSync(currentPath)) {
      const itemPath = path.join(currentPath, item)
      const itemRelativePath = relativePath
        ? path.join(relativePath, item)
        : item

      // Match by path segment, not substring — so `.git` doesn't accidentally
      // exclude `.gitignore`, and a user-supplied `src` doesn't exclude every
      // path containing the letters "src".
      const segments = itemRelativePath.split(/[/\\]/)
      if (ignoreList.some((ignore) => segments.includes(ignore))) {
        core.debug(`Ignoring: ${itemPath}`)
        continue
      }

      if (fs.statSync(itemPath).isDirectory()) {
        addFilesToZip(itemPath, itemRelativePath)
      } else {
        core.debug(`Adding file: ${itemPath} as ${itemRelativePath}`)
        zip.addLocalFile(
          itemPath,
          path.dirname(itemRelativePath),
          path.basename(itemRelativePath)
        )
      }
    }
  }

  addFilesToZip(sourceDir)

  zip.writeZip(outputPath)
  core.info(`ZIP archive created at: ${outputPath}`)
}

// force_update=false: never overwrite tasks that already exist server-side.
// retain_deleted=false: prune server tasks missing from the archive.
export async function uploadArchive(
  zipPath: string,
  realm: string,
  repoName: string,
  apiKey: string
): Promise<void> {
  core.info('Uploading archive to PumpRoom...')

  const buffer = fs.readFileSync(zipPath)
  const blob = new Blob([new Uint8Array(buffer)], { type: 'application/zip' })

  const formData = new FormData()
  formData.append('realm', realm)
  formData.append('repo_name', repoName)
  formData.append('force_update', 'false')
  formData.append('retain_deleted', 'false')
  formData.append('archive', blob, path.basename(zipPath))

  let response: Response
  try {
    response = await postWithTimeout(
      UPLOAD_URL,
      {
        method: 'POST',
        headers: { 'X-API-KEY': apiKey },
        body: formData
      },
      600_000
    )
  } catch (error) {
    const message = toErrorMessage(error)
    core.error(`❌ API request failed: ${message}`)
    throw new Error(`Unable to upload archive: ${message}`)
  }

  core.info(`Response status: ${response.status}`)
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    core.error(`Status code: ${response.status}`)
    core.error(`Response: ${body}`)
    throw new Error(`Unable to upload archive: HTTP ${response.status}`)
  }

  const data = (await response.json()) as PumpRoomApiResponse
  core.info(formatPumpRoomResponse(data))
  core.info('✅ Repo and tasks successfully registered')
}
