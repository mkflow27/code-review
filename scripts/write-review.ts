import path from 'path'
import * as dotenv from 'dotenv'
import yargs from 'yargs'
import crypto from 'crypto'
import { hideBin } from 'yargs/helpers'
import { Address } from 'viem'

import RateProviderDataService from '../src/app'
import { template } from '../src/utils/template'
import {
    base,
    mainnet,
    arbitrum,
    avalanche,
    gnosis,
    sonic,
    sepolia,
    polygon,
    fraxtal,
    Chain,
    optimism,
    polygonZkEvm,
    mode,
} from 'viem/chains'

import { hyperEvm } from '../src/utils/customChains'
import { writeReviewAndUpdateRegistry } from '../src/utils/write-rp-review'

import HypernativeApi from '../src/services/hypernativeApi'
import { doOnchainCallGetName } from '../src'

dotenv.config()
const fs = require('fs')

// to use this script use the command below
// for network see the viem chains
// Important: The custom RPC URL in the .env must support createAccessList (or the viem default rpc url)
// npm run write-review -- --rateProviderAddress <address> --network <network> --rateProviderAsset <asset> --rpcUrl <rpcUrl>

// Mapping of chain names to registry keys
const chainNameToRegistryKey: { [key: string]: string } = {
    'Arbitrum One': 'arbitrum',
    mainnet: 'ethereum',
    'OP Mainnet': 'optimism',
    'Polygon zkEVM': 'zkevm',
    'Mode Mainnet': 'mode',
}

async function createCustomAgents(rateProvider: Address, chain: Chain) {
    // get the relevant information from the registry
    const registryPath = path.join(__dirname, '../rate-providers/registry.json')
    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'))

    const registryKey = chainNameToRegistryKey[chain.name] || chain.name.toLowerCase()
    const rateProviderData = registry[registryKey][rateProvider]

    const upgradeableComponents = rateProviderData.upgradeableComponents.map(
        (component: { entrypoint: any }) => component.entrypoint,
    )

    const hypernativeApi = new HypernativeApi(
        chain,
        process.env.HYPERNATIVE_CLIENT_ID || '',
        process.env.HYPERNATIVE_CLIENT_SECRET || '',
    )

    await hypernativeApi.createCustomAgentRateDeviation({
        chain,
        ruleString: `On ${chain.name}: when ${rateProvider}: getRate().uint256 changed by 10% in less than 10 blocks.\nSample every 5 blocks`,
        contractAddress: rateProvider,
        contractAlias: rateProvider,
        agentName: `${rateProvider.slice(-4)}rate-deviation`,
        rateProvider: rateProvider,
    })

    await hypernativeApi.createCustomAgentUpgrade({
        chain,
        ruleString: `On ${chain.name}: when ${upgradeableComponents.map((component: string) => component).join(' or ')}: Upgraded(indexed address implementation)}`,
        contractAddress: upgradeableComponents,
        contractAlias: upgradeableComponents.map((component: string) => component).join(' or '),
        agentName: `${rateProvider.slice(-4)}-upgrade`,
        rateProvider: rateProvider,
    })

    await hypernativeApi.createCustomAgentRateRevert({
        chain,
        ruleString: `On ${chain.name}: when ${rateProvider}: getRate() reverts`,
        contractAddress: rateProvider,
        contractAlias: rateProvider,
        agentName: `${rateProvider.slice(-4)}rate-revert`,
        rateProvider: rateProvider,
    })
}

// Parse command-line arguments using yargs
async function main() {
    const argv = await yargs(hideBin(process.argv))
        .option('rateProviderAddress', {
            alias: 'r',
            type: 'string',
            description: 'The address of the rate provider',
            demandOption: true,
        })
        .option('network', {
            alias: 'n',
            type: 'string',
            description: 'The network the rate provider is deployed on',
            choices: ['base', 'mainnet', 'arbitrum', 'avalanche', 'gnosis', 'fraxtal', 'optimism', 'sonic', 'hyperEvm'],
            demandOption: true,
        })
        .option('rateProviderAsset', {
            alias: 'a',
            type: 'string',
            description: 'The asset the rate provider provides the rate for',
            demandOption: true,
        })
        .option('rpcUrl', {
            alias: 'u',
            type: 'string',
            description: 'The custom RPC URL to use for the network',
            demandOption: true,
        }).argv

    // Map network name to Chain object
    const networks: { [key: string]: Chain } = {
        base,
        mainnet,
        arbitrum,
        avalanche,
        gnosis,
        fraxtal,
        optimism,
        sonic,
        sepolia,
        polygon,
        polygonZkEvm,
        mode,
        hyperEvm,
    }

    let network = networks[argv.network]

    if (!network) {
        console.error(`Unsupported network: ${argv.network}`)
        process.exit(1)
    }

    // Override the default RPC URL
    // Reason it must be an RPC URL that supports createAccessList
    network = {
        ...network,
        rpcUrls: {
            ...network.rpcUrls,
            default: {
                http: [argv.rpcUrl],
            },
        },
    }

    // some viem chains do not have a block explorer api url set
    if (argv.network === 'sonic') {
        network = {
            ...network,
            blockExplorers: {
                ...network.blockExplorers,
                default: {
                    ...network.blockExplorers?.default,
                    apiUrl: 'https://api.sonicscan.org/api',
                    name: 'SonicScan',
                    url: network.blockExplorers?.default?.url || 'https://sonicscan.io',
                },
            },
        }
    }

    const rateProviderAddress = argv.rateProviderAddress.startsWith('0x')
        ? (argv.rateProviderAddress as Address)
        : (() => {
              throw new Error(`Invalid rateProviderAddress: ${argv.rateProviderAddress}. It must start with "0x".`)
          })()

    const rateProviderAsset = argv.rateProviderAsset.startsWith('0x')
        ? (argv.rateProviderAsset as Address)
        : (() => {
              throw new Error(`Invalid rateProviderAsset: ${argv.rateProviderAsset}. It must start with "0x".`)
          })()

    await writeReviewAndUpdateRegistry(rateProviderAddress, network, rateProviderAsset, argv.rpcUrl)

    // the registry file has been updated. All relevant information can be read from there and don't need to be passed as arguments
    // await createCustomAgents(rateProviderAddress, network)
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})
