import { main } from './readback'

process.exitCode = await main(process.argv.slice(2), (line) => {
  process.stdout.write(`${line}\n`)
})
