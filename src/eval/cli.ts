import { main } from './command'

process.exitCode = main(process.argv.slice(2), (line) => {
  process.stdout.write(`${line}\n`)
})
