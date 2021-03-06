import { URL, URLSearchParams } from 'url';
import { Inject, Service } from 'typedi';
import fetch from 'node-fetch';
import { ethers } from 'ethers';
import { Cacheable } from '@vesper-discord/redis-service';
import { BlockchainService, NotProxyAddressError } from '@vesper-discord/blockchain-service';
import { BigNumber } from 'bignumber.js';
import { Logger, Log } from '@vesper-discord/logger';
import { Retriable } from '@vesper-discord/retry';
import { ErrorHandler } from '@vesper-discord/errors';
import { omitBy, isNil } from 'lodash';
import { Config } from './config';
import {
  GetGasOracleResponse,
  BlockchainScanResponse,
  BlockchainScanFetchParams,
  GetListOfNormalTransactionsByAddressResponse,
  GetListOfERC20TokenTransferEventsByAddressResponse,
  BlockchainScanServiceType,
} from './interfaces';
import { BlockchainScanError, BlockchainScanErrorConverter } from './errors/index';

export interface GetERC20TokenAccountBalanceForTokenContractAddressProps {
  contractAddress: string;
  address: string;
}

export interface GetListOfNormalTransactionsByAddressProps {
  /**
   * The string representing the addresses to check for balance
   */
  address: string;
  /**
   * The integer block number to start searching for transactions
   */
  startblock?: number;
  /**
   * The integer block number to stop searching for transactions
   */
  endblock?: number;
  /**
   * The integer page number, if pagination is enabled
   */
  page?: number;
  /**
   * The number of transactions displayed per page
   */
  offset?: number;
  /**
   * The sorting preference, use asc to sort by ascending and desc to sort by descendin
   * Tip: Specify a smaller startblock and endblock range for faster search results.
   */
  sort?: 'asc' | 'desc';
}

export interface GetListOfERC20TokenTransferEventsByAddressProps {
  /**
   * The string representing the addresses to check for balance
   */
  address?: string;
  /**
   * the string representing the token contract address to check for balance
   */
  contractAddress?: string;
  /**
   * The integer block number to start searching for transactions
   */
  startblock?: number;
  /**
   * The integer block number to stop searching for transactions
   */
  endblock?: number;
  /**
   * The integer page number, if pagination is enabled
   */
  page?: number;
  /**
   * The number of transactions displayed per page
   */
  offset?: number;
  /**
   * The sorting preference, use asc to sort by ascending and desc to sort by descendin
   * Tip: Specify a smaller startblock and endblock range for faster search results.
   */
  sort?: 'asc' | 'desc';
}

interface GetContractABIFromAddressProps {
  contractAddress: string;
  followProxy?: boolean;
}

@Service()
export abstract class BlockchainScanService {
  @Inject(() => Config)
  protected readonly config!: Config;

  protected abstract readonly logger: Logger;

  protected abstract blockchainService: BlockchainService;
  protected abstract get baseUrl(): string;
  protected abstract get apiKey(): string;
  protected abstract get scanServiceType(): BlockchainScanServiceType;

  /**
   * Returns the current Safe, Proposed and Fast gas prices.
   * @cacheable 5 seconds
   */
  @Cacheable({
    ttlSeconds: 5,
  })
  public async getGasOracle() {
    return this.fetch<GetGasOracleResponse>({
      action: 'gasoracle',
      module: 'gastracker',
    });
  }

  /**
   * Returns the current Safe, Proposed and Fast gas prices.
   * @cacheable 5 seconds
   */
  @Cacheable({
    ttlSeconds: 5,
  })
  public async getEstimationOfConfirmationTime(gasPrice: string | number | BigNumber) {
    return this.fetch<string>({
      action: 'gasestimate',
      gasprice: gasPrice.toString(),
      module: 'gastracker',
    });
  }

  /**
   * Returns the list of transactions performed by an address, with optional pagination.
   * @url https://docs.etherscan.io/api-endpoints/accounts#get-a-list-of-normal-transactions-by-address
   * @cacheable 5 seconds
   */
  // @Cacheable({
  // ttlSeconds: 5,
  // })
  public async getListOfNormalTransactionsByAddress(props: GetListOfNormalTransactionsByAddressProps) {
    return this.fetch<GetListOfNormalTransactionsByAddressResponse[]>({
      action: 'txlist',
      address: props.address,
      endblock: props.endblock,
      module: 'account',
      offset: props.offset,
      page: props.page,
      sort: props.sort,
      startblock: props.startblock,
    });
  }

  /**
   * Returns the list of transactions performed by an address, with optional pagination.
   * @url https://docs.etherscan.io/api-endpoints/accounts#get-a-list-of-normal-transactions-by-address
   * @cacheable 5 seconds
   */
  // @Cacheable({
  // ttlSeconds: 5,
  // })
  public async getListOfERC20TokenTransferEventsByAddress(props: GetListOfERC20TokenTransferEventsByAddressProps) {
    return this.fetch<GetListOfERC20TokenTransferEventsByAddressResponse[]>({
      action: 'tokentx',
      address: props.address,
      contractaddress: props.contractAddress,
      endblock: props.endblock,
      module: 'account',
      offset: props.offset,
      page: props.page,
      sort: props.sort,
      startblock: props.startblock,
    });
  }

  /**
   * Prase the transaction receipt to get the log data
   */
  @Log({
    logInput: ({ input }) => input[0].transactionHash.toLowerCase(),
  })
  @ErrorHandler({ converter: BlockchainScanErrorConverter })
  public async parseTransactionReceiptLogs(receipt: ethers.providers.TransactionReceipt) {
    const logsCopy = [...receipt.logs];

    return Promise.all(
      logsCopy.map(async (log) => {
        const contractAbiResponse = await this.getContractABIFromAddress({
          contractAddress: log.address,
          followProxy: true,
        });

        const contractInterface = new ethers.utils.Interface(contractAbiResponse);

        if (contractInterface) {
          const parsedLog = this.blockchainService.parseTransactionLog(contractInterface, log);

          return {
            ...log,
            parsedLog,
          };
        }
      }),
    );
  }

  /**
   * Returns the transaction receipt for a given transaction hash.
   * @cacheable 1 day
   */
  @Log({
    logInput: ({ input }) => ({
      contractAddress: input[0].contractAddress.toLowerCase(),
      followProxy: input[0].followProxy,
    }),
  })
  @Cacheable({
    cacheKey: (args) => {
      const { contractAddress, followProxy } = args[0];
      return `${contractAddress.toLowerCase()}${followProxy ? ':proxy' : ''}`;
    },
    ttlSeconds: 60 * 60 * 24 * 30, // 30 days,
  })
  public async getContractABIFromAddress({
    contractAddress,
    followProxy,
  }: GetContractABIFromAddressProps): Promise<string> {
    let finalContractAddress = contractAddress;

    if (followProxy) {
      try {
        finalContractAddress = await this.blockchainService.findImplementationAddressFromProxyAddress(contractAddress);
      } catch (err) {
        if (!(err instanceof NotProxyAddressError)) {
          throw err;
        }
      }
    }

    const { result } = await this.fetch<string>({
      action: 'getabi',
      address: finalContractAddress,
      module: 'contract',
    });

    return result;
  }

  @Log({
    logInput: ({ input }) => input[0].toLowerCase(),
  })
  public async getContractFromAddress(address: string) {
    const abi = await this.getContractABIFromAddress({
      contractAddress: address,
      followProxy: true,
    });

    return new ethers.Contract(address, abi, this.blockchainService.provider);
  }

  /**
   * Returns the current amount of an ERC-20 token in circulation.
   * @cacheable 5 seconds
   * @tip The result is returned in the token's smallest decimal representation.
   * Eg. a token with a balance of 215.241526476136819398 and 18 decimal places will be returned as 215241526476136819398
   */
  @Cacheable({
    ttlSeconds: 5,
  })
  public async getERC20TokenTotalSupplyByContractAddress(contractAddress: string) {
    const response = await this.fetch<BigNumber>({
      action: 'tokensupply',
      contractaddress: contractAddress,
      module: 'stats',
    });

    return { ...response, result: new BigNumber(response.result) };
  }

  /**
   * Returns the current balance of an ERC-20 token of an address.
   * @cacheable 5 seconds
   * @tip The result is returned in the token's smallest decimal representation.
   * Eg. a token with a balance of 215.241526476136819398 and 18 decimal places will be returned as 215241526476136819398
   */
  @Cacheable({
    ttlSeconds: 5,
  })
  public async getERC20TokenAccountBalanceForTokenContractAddress({
    contractAddress,
    address,
  }: GetERC20TokenAccountBalanceForTokenContractAddressProps) {
    const response = await this.fetch<BigNumber>({
      action: 'tokenbalance',
      address: address,
      contractaddress: contractAddress,
      module: 'account',
    });

    return { ...response, result: new BigNumber(response.result) };
  }

  @Log({
    logInput: ({ scope, input }) => {
      const [params] = input;
      const cleanParams = omitBy(params, isNil);
      const searchParams = new URLSearchParams({
        ...cleanParams,
        apikey: scope.apiKey,
      });

      const url = new URL(scope.baseUrl);
      url.search = searchParams.toString();

      return {
        ...cleanParams,
        url: url.toString().replace(scope.apiKey, '****'),
      };
    },
    logLevel: 'trace',
    logResult: ({ result }) => result.message,
    message: 'Fetching data from Etherscan',
  })
  @Retriable()
  @ErrorHandler<BlockchainScanError, { scanService: BlockchainScanServiceType }>({
    converter: BlockchainScanErrorConverter,
    extraProps: ({ scope }) => ({ scanService: scope.scanServiceType }),
  })
  private async fetch<T>(params: BlockchainScanFetchParams): Promise<BlockchainScanResponse<T>> {
    const searchParams = new URLSearchParams({
      ...omitBy(params, isNil),
      apikey: this.apiKey,
    });

    const url = new URL(this.baseUrl);
    url.search = searchParams.toString();

    const result = (await fetch(url.toString(), {
      method: 'GET',
    }).then((response) => response.json())) as BlockchainScanResponse<T>;

    // TODO: Retry if rate limit exceeded
    // Max rate limit reached: https://docs.etherscan.io/support/rate-limits
    if (result.status === '0') {
      const error = new Error(result.result as unknown as string);
      (error as any).code = result.message;
      (error as any).status = result.status;
      (error as any).action = params.action;
      (error as any).module = params.module;
      (error as any).url = url.toString().replace(this.apiKey, '****');

      throw error;
    }

    return result;
  }
}
