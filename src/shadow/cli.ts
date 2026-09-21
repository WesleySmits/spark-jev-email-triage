import { main } from './command'

process.exitCode = await main(process.argv.slice(2), process.env, (line) => {
  process.stdout.write(`${line}\n`)
})
