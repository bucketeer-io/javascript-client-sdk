import packageJson from '../package.json'
import { execSync } from 'child_process'

const version = ((args) => {
  if (args.length < 3) {
    return packageJson.version
  }
  return args[2]
})(process.argv)
const sha = execSync('git rev-parse --short HEAD').toString().trim()
const timestamp = Math.round(Date.now() / 1000)

console.log(`${version}-${timestamp}-${sha}`)
