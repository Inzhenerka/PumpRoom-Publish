#!/usr/bin/env node

/**
 * Platform-independent scripts for publishing the GitHub Action
 *
 * This scripts performs the following steps:
 * 1. Checks for uncommitted changes and throws an error if any exist
 * 2. Accepts "minor" or "patch" commands for versioning
 * 3. Switches to branch v1
 * 4. Builds using "bun all"
 * 5. Commits the result
 * 6. Executes npm version and pushes
 * 7. Merges the branch into main and pushes
 *
 * Usage:
 *   node scripts/publish.js <minor|patch>
 */

import { execSync } from 'child_process'
import path from 'path'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Helper function to execute shell commands and print output
function exec(command, options = {}) {
  console.log(`> ${command}`)
  return execSync(command, {
    stdio: 'inherit',
    ...options
  })
}

// Helper function to check if a command exists
function commandExists(command) {
  try {
    execSync(`${command} --version`, { stdio: 'ignore' })
    return true
  } catch (error) {
    return false
  }
}

// Main function
async function main() {
  try {
    // Validate arguments
    const versionType = process.argv[2]
    if (!versionType || (versionType !== 'minor' && versionType !== 'patch')) {
      console.error('Error: Please specify version type: minor or patch')
      console.error('Usage: node scripts/publish.js <minor|patch>')
      process.exit(1)
    }

    // Step 0: Check for uncommitted changes
    try {
      const status = execSync('git status --porcelain').toString().trim()
      if (status) {
        console.error('Error: There are uncommitted changes in the repository.')
        console.error('Please commit or stash your changes before publishing.')
        process.exit(1)
      }
    } catch (error) {
      console.error('Error checking git status:', error.message)
      process.exit(1)
    }

    // Step 1: Switch to branch v1
    try {
      // Check if branch exists
      const branches = execSync('git branch').toString()
      if (branches.includes('v1')) {
        exec('git checkout v1')
      } else {
        console.log('Branch v1 does not exist. Creating it...')
        exec('git checkout -b v1')
      }
    } catch (error) {
      console.error('Error switching to branch v1:', error.message)
      process.exit(1)
    }

    // Step 2: Build using bun all
    try {
      if (commandExists('bun')) {
        exec('bun all')
      } else {
        console.log('Bun not found, using npm instead')
        exec('npm run all')
      }
    } catch (error) {
      console.error('Error building the project:', error.message)
      process.exit(1)
    }

    // Step 3: Commit the result
    try {
      // Check if there are changes to commit after build
      const status = execSync('git status --porcelain').toString().trim()
      if (status) {
        exec('git add .')
        exec('git commit -m "build: update distribution files"')
      } else {
        console.log('No changes to commit after build')
      }
    } catch (error) {
      console.error('Error committing changes:', error.message)
      process.exit(1)
    }

    // Step 4: Execute npm version and push
    try {
      exec(`npm version ${versionType} --no-git-tag-version`)

      // Get the new version from package.json
      const packageJsonPath = path.join(process.cwd(), 'package.json')
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
      const newVersion = packageJson.version

      // Commit the version change
      exec('git add package.json')
      exec(`git commit -m "chore: bump version to ${newVersion}"`)

      // Create tag
      exec(`git tag v${newVersion} -m "v${newVersion} Release"`)

      // Push branch and tags
      exec('git push origin v1 --follow-tags')
    } catch (error) {
      console.error('Error updating version and pushing:', error.message)
      process.exit(1)
    }

    // Step 5: Merge the branch into main and push
    try {
      // Switch to main branch
      exec('git checkout main')

      // Merge v1 into main
      exec('git merge v1 --no-ff -m "Merge branch v1 into main"')

      // Push main
      exec('git push origin main')

      // Switch back to v1
      exec('git checkout v1')
    } catch (error) {
      console.error('Error merging into main and pushing:', error.message)
      process.exit(1)
    }

    console.log('✅ Publication completed successfully!')
  } catch (error) {
    console.error('An unexpected error occurred:', error.message)
    process.exit(1)
  }
}

// Run the main function
main().catch((error) => {
  console.error('Unhandled error:', error)
  process.exit(1)
})