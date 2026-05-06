#!/usr/bin/env node

/**
 * Platform-independent script for publishing the GitHub Action.
 *
 * Steps:
 * 1. Verifies current branch is main and working tree is clean
 * 2. Builds the action via `bun all` (falls back to `npm run all`)
 * 3. Commits build artifacts (if any) on main
 * 4. Bumps version (major|minor|patch), tags, and pushes main with tags
 * 5. Fast-forwards remote `v<major>` branch (e.g. v1, v2) to main
 *
 * Usage:
 *   node scripts/publish.js <major|minor|patch>
 */

import { execSync } from 'child_process'
import path from 'path'
import { readFileSync } from 'fs'

function exec(command, options = {}) {
  console.log(`> ${command}`)
  return execSync(command, { stdio: 'inherit', ...options })
}

function commandExists(command) {
  try {
    execSync(`${command} --version`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

async function main() {
  const versionType = process.argv[2]
  if (!['major', 'minor', 'patch'].includes(versionType)) {
    console.error('Error: Please specify version type: major, minor, or patch')
    console.error('Usage: node scripts/publish.js <major|minor|patch>')
    process.exit(1)
  }

  // Step 0: Check that current branch is main
  try {
    const currentBranch = execSync('git branch --show-current')
      .toString()
      .trim()
    if (currentBranch !== 'main') {
      console.error(
        `Error: Current branch is '${currentBranch}', but 'main' is required for publishing.`
      )
      process.exit(1)
    }
    console.log('✓ Current branch is main')
  } catch (error) {
    console.error('Error checking current branch:', error.message)
    process.exit(1)
  }

  // Step 1: Check for uncommitted changes
  try {
    const status = execSync('git status --porcelain').toString().trim()
    if (status) {
      console.error('Error: There are uncommitted changes in the repository.')
      console.error('Please commit or stash your changes before publishing.')
      process.exit(1)
    }
    console.log('✓ No uncommitted changes')
  } catch (error) {
    console.error('Error checking git status:', error.message)
    process.exit(1)
  }

  // Step 2: Build
  try {
    console.log('Building the project...')
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

  // Step 3: Commit build artifacts (if any)
  try {
    const status = execSync('git status --porcelain').toString().trim()
    if (status) {
      exec('git add .')
      exec('git commit -m "build: update distribution files"')
      console.log('✓ Build changes committed')
    } else {
      console.log('✓ No changes to commit after build')
    }
  } catch (error) {
    console.error('Error committing changes:', error.message)
    process.exit(1)
  }

  // Step 4: Bump version, tag, push main
  let newVersion
  try {
    const packageJsonPath = path.join(process.cwd(), 'package.json')
    const currentVersion = JSON.parse(
      readFileSync(packageJsonPath, 'utf8')
    ).version

    exec(`npm version ${versionType} --no-git-tag-version`)

    newVersion = JSON.parse(readFileSync(packageJsonPath, 'utf8')).version

    exec('git add package.json')
    exec(
      `git commit -m "chore: bump version from ${currentVersion} to ${newVersion}"`
    )
    exec(`git tag v${newVersion} -m "v${newVersion} Release"`)
    exec('git push origin main --follow-tags')
    console.log(
      `✓ Version updated from ${currentVersion} to ${newVersion}, pushed to main`
    )
  } catch (error) {
    console.error('Error updating version and pushing main:', error.message)
    process.exit(1)
  }

  // Step 5: Fast-forward `v<major>` to main. For a major bump this creates
  // the new branch (e.g. v2); for minor/patch it advances the existing one.
  // The previous major's branch (e.g. v1) is left untouched on a major bump.
  const releaseBranch = `v${newVersion.split('.')[0]}`
  try {
    exec(`git push origin main:${releaseBranch}`)
    console.log(`✓ ${releaseBranch} release branch updated to main`)
  } catch (error) {
    console.error(`Error updating ${releaseBranch} branch:`, error.message)
    console.error(
      `If ${releaseBranch} has diverged from main, resolve manually before retrying.`
    )
    process.exit(1)
  }

  console.log('✅ Publication completed successfully!')
  console.log(
    `Process completed: main → v${newVersion} tag → push main → push ${releaseBranch}`
  )
}

main().catch((error) => {
  console.error('Unhandled error:', error)
  process.exit(1)
})
