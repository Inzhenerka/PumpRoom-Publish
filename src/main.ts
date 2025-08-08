import * as core from '@actions/core'
import * as fs from 'fs'
import * as path from 'path'
import AdmZip from 'adm-zip'
import axios from 'axios'
import { FormData } from 'formdata-node'
import { fileFromPath } from 'formdata-node/file-from-path'

/**
 * Interface for the PumpRoom API response
 */
export interface PumpRoomApiResponse {
  pushed_at: string
  tasks_uploaded: number
  tasks_created: number
  tasks_updated: number
  tasks_deleted: number
  tasks_retained: number
}

/**
 * Formats the PumpRoom API response for better readability in console output
 *
 * @param response - The API response to format
 * @returns A formatted string representation of the response
 */
export function formatPumpRoomResponse(response: PumpRoomApiResponse): string {
  const date = new Date(response.pushed_at)
  const formattedDate = date.toLocaleString()
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

/**
 * Validates that folder names are unique (case-insensitive).
 *
 * @param rootDir - The root directory to check
 * @returns A promise that resolves when validation is complete
 * @throws Error if duplicate folder names are found
 */
export async function validateUniqueFolderNames(
  rootDir: string
): Promise<void> {
  core.info('🔍 Validating unique folder names...')

  try {
    // Get list of folders
    const items = fs.readdirSync(rootDir)
    const folders: string[] = []

    // Filter out only directories
    for (const item of items) {
      const itemPath = path.join(rootDir, item)
      if (fs.statSync(itemPath).isDirectory()) {
        folders.push(item)
      }
    }

    // Check if there are any folders to analyze
    if (folders.length === 0) {
      core.info('ℹ️ No folders found to validate')
      return
    }

    // Look for duplicates (case-insensitive)
    const folderMap = new Map<string, string[]>()
    for (const folder of folders) {
      const lowerCaseFolder = folder.toLowerCase()
      if (!folderMap.has(lowerCaseFolder)) {
        folderMap.set(lowerCaseFolder, [])
      }
      folderMap.get(lowerCaseFolder)?.push(folder)
    }

    // Find duplicates
    const duplicates: string[] = []
    for (const [lowerCaseFolder, folderVariants] of folderMap.entries()) {
      if (folderVariants.length > 1) {
        duplicates.push(lowerCaseFolder)
      }
    }

    // Report duplicates if found
    if (duplicates.length > 0) {
      let errorMessage = '❌ Folder duplicates found:\n'
      for (const duplicate of duplicates) {
        const variants = folderMap.get(duplicate)
        errorMessage += `  • ${duplicate} (variants: ${variants?.join(', ')})\n`
      }
      throw new Error(errorMessage)
    }

    core.info('✅ No folder duplicates found')
  } catch (error) {
    if (error instanceof Error) {
      throw error
    } else {
      throw new Error('Unknown error during folder validation')
    }
  }
}

/**
 * Validates the .inzhenerka.yml configuration file.
 *
 * @param rootDir - The root directory containing the .inzhenerka.yml file
 * @returns A promise that resolves when validation is complete
 * @throws Error if the configuration is invalid
 */
export async function validateInzhenerkaYml(rootDir: string): Promise<void> {
  core.info('🔍 Validating .inzhenerka.yml...')

  const configPath = path.join(rootDir, '.inzhenerka.yml')

  try {
    // Check if the file exists
    if (!fs.existsSync(configPath)) {
      throw new Error('❌ .inzhenerka.yml file not found')
    }

    // Read the file content
    const configContent = fs.readFileSync(configPath, 'utf8')

    // Prepare the request body
    const jsonBody = JSON.stringify({ config_yml: configContent })

    // Make the API request
    const response = await axios.post(
      'https://pumproom-api.inzhenerka-cloud.com/inzhenerka_schema',
      jsonBody,
      {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 60000 // 1 minute timeout for validation
      }
    )

    // Check the response status
    if (response.status === 200) {
      core.info('✅ Configuration is valid')
    } else {
      throw new Error(
        `❌ Configuration is invalid. HTTP status: ${response.status}`
      )
    }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      let errorMessage = '❌ Configuration validation failed:\n'
      if (error.response) {
        errorMessage += `Status code: ${error.response.status}\n`
        errorMessage += `Response: ${JSON.stringify(error.response.data)}\n`
      } else {
        errorMessage += `Error: ${error.message}\n`
      }
      throw new Error(errorMessage)
    } else if (error instanceof Error) {
      throw error
    } else {
      throw new Error('Unknown error during configuration validation')
    }
  }
}

/**
 * The main function for the action.
 *
 * @returns Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    // Get inputs
    const rootDir = core.getInput('root_dir') || process.cwd()
    const ignoreInput = core.getInput('ignore') || ''
    const realm = core.getInput('realm')
    const repoName = core.getInput('repo_name')
    const apiKey = core.getInput('api_key')

    // Always ignore .git and .github directories
    const ignoreList = ['.git', '.github']

    // Add user-specified ignores
    if (ignoreInput) {
      ignoreList.push(...ignoreInput.split(',').map((item) => item.trim()))
    }

    core.debug(`Root directory: ${rootDir}`)
    core.debug(`Ignore list: ${ignoreList.join(', ')}`)

    // Validate unique folder names
    await validateUniqueFolderNames(rootDir)

    // Validate .inzhenerka.yml configuration
    await validateInzhenerkaYml(rootDir)

    // Create a temporary file for the ZIP archive
    const tempZipPath = path.join(process.cwd(), 'repo-archive.zip')

    // Create ZIP archive
    await createZipArchive(rootDir, tempZipPath, ignoreList)

    // Upload the ZIP archive
    await uploadArchive(tempZipPath, realm, repoName, apiKey)

    // Clean up the temporary file
    fs.unlinkSync(tempZipPath)

    core.info('✅ Repository successfully published to PumpRoom')
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) {
      core.setFailed(error.message)
    } else {
      core.setFailed('An unknown error occurred')
    }
  }
}

/**
 * Creates a ZIP archive of the specified directory.
 *
 * @param sourceDir - The directory to archive
 * @param outputPath - The path where the ZIP file will be created
 * @param ignoreList - List of files and directories to ignore
 */
export async function createZipArchive(
  sourceDir: string,
  outputPath: string,
  ignoreList: string[]
): Promise<void> {
  core.info('Creating ZIP archive...')

  const zip = new AdmZip()

  // Function to recursively add files to the ZIP
  function addFilesToZip(currentPath: string, relativePath: string = '') {
    const items = fs.readdirSync(currentPath)

    for (const item of items) {
      const itemPath = path.join(currentPath, item)
      const itemRelativePath = relativePath
        ? path.join(relativePath, item)
        : item

      // Skip if the item is in the ignore list
      if (ignoreList.some((ignore) => itemPath.includes(ignore))) {
        core.debug(`Ignoring: ${itemPath}`)
        continue
      }

      const stats = fs.statSync(itemPath)

      if (stats.isDirectory()) {
        // Recursively add files from subdirectories
        addFilesToZip(itemPath, itemRelativePath)
      } else {
        // Add file to ZIP
        core.debug(`Adding file: ${itemPath} as ${itemRelativePath}`)
        zip.addLocalFile(
          itemPath,
          path.dirname(itemRelativePath),
          path.basename(itemRelativePath)
        )
      }
    }
  }

  // Start adding files from the source directory
  addFilesToZip(sourceDir)

  // Write the ZIP file
  zip.writeZip(outputPath)

  core.info(`ZIP archive created at: ${outputPath}`)
}

/**
 * Uploads the ZIP archive to the PumpRoom API using the /upload_tasks endpoint.
 *
 * @param zipPath - Path to the ZIP archive
 * @param realm - Realm identifier (unique school identifier)
 * @param repoName - Repository name (unique name provided by PumpRoom Admin)
 * @param apiKey - API key for authentication
 *
 * Note: This function uses default values for force_update (false) and retain_deleted (false).
 * - force_update: Force update of every existing tasks
 * - retain_deleted: Keep previously uploaded tasks that are not present in the archive
 */
export async function uploadArchive(
  zipPath: string,
  realm: string,
  repoName: string,
  apiKey: string
): Promise<void> {
  core.info('Uploading archive to PumpRoom...')

  try {
    // Create form data
    const formData = new FormData()
    formData.append('realm', realm)
    formData.append('repo_name', repoName)
    formData.append('force_update', 'false')
    formData.append('retain_deleted', 'false')

    // Add the ZIP file
    const file = await fileFromPath(zipPath)
    formData.append('archive', file)

    // Make the API request
    const response = await axios.post(
      'https://pumproom-api.inzhenerka-cloud.com/repo/upload_tasks',
      formData,
      {
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'multipart/form-data'
        },
        timeout: 600000 // 10 minutes timeout to prevent 504 errors
      }
    )

    core.info(`Response status: ${response.status}`)
    if (response.status !== 200) {
      throw new Error(`Unable to register repo, code: ${response.status}`)
    } else {
      // Type the response data and format it for display
      const responseData = response.data as PumpRoomApiResponse
      core.info(formatPumpRoomResponse(responseData))
      core.info('✅ Repo and tasks successfully registered')
    }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      core.error(`❌ API request failed: ${error.message}`)
      if (error.response) {
        core.error(`Status code: ${error.response.status}`)
        core.error(`Response: ${JSON.stringify(error.response.data)}`)
      }
      throw new Error(`Unable to upload archive: ${error.message}`)
    } else {
      throw error
    }
  }
}
