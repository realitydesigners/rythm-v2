const key = process.env.NEXT_PUBLIC_OANDA_TOKEN as string;
const acc_id = process.env.NEXT_PUBLIC_ACCOUNT_ID as string;
const base_url = process.env.NEXT_PUBLIC_OANDA_BASE_URL as string;
const stream_url = process.env.NEXT_PUBLIC_OANDA_STREAM_URL as string;

export class OandaApi {
	private api_key: string;
	private oanda_url: string;
	private account_id: string;
	private stream_link: string;
	private activeStreams: Map<string, ReadableStreamDefaultReader<Uint8Array>> =
		new Map();

	constructor(
		api_key: string,
		oanda_url: string = base_url,
		account_id: string,
		stream_link: string = stream_url,
	) {
		// Initialize Oanda API with optional API key, base URL, and account ID.

		this.api_key = api_key;
		this.oanda_url = oanda_url;
		this.account_id = account_id;
		this.stream_link = stream_link;
	}

	public async subscribeToPairs(
		pairs: string[],
		onData: (data: any, pair: string) => void,
	) {
		if (!this.api_key || !this.account_id) {
			console.error("API key or account ID is missing.");
			return null;
		}
		for (const pair of pairs) {
			if (!this.activeStreams.has(pair)) {
				try {
					const response = await fetch(
						`${this.stream_link}/accounts/${this.account_id}/pricing/stream?instruments=${pair}`,
						{
							headers: {
								Authorization: `Bearer ${this.api_key}`,
								"Content-Type": "application/json",
							},
						},
					);

					if (!response.ok) {
						throw new Error(`Failed to fetch data for pair: ${pair}`);
					}

					const reader = response.body?.getReader();

					if (reader) {
						this.activeStreams.set(pair, reader);
						this.streamData(pair, reader, onData);
					} else {
						console.error(`Failed to get reader for pair: ${pair}`);
					}
				} catch (error) {
					console.error(`Error while subscribing to pair ${pair}: ${error}`);
				}
			}
		}
	}

	public unsubscribeFromPairs(pairs: string[]): string[] {
		const successfullyUnsubscribed = [];

		for (const pair of pairs) {
			const reader = this.activeStreams.get(pair);
			if (reader) {
				reader.cancel();
				this.activeStreams.delete(pair);
				successfullyUnsubscribed.push(pair);
			}
		}

		return successfullyUnsubscribed;
	}

	private async streamData(
		pair: string,
		reader: ReadableStreamDefaultReader<Uint8Array>,
		onData: (data: any, pair: string) => void,
	) {
		let buffer = "";
		try {
			while (true) {
				const result = await reader.read();
				if (result.done) break;
				buffer += new TextDecoder().decode(result.value);

				let newlineIndex = buffer.indexOf("\n");
				while (newlineIndex !== -1) {
					const singleJSON = buffer.slice(0, newlineIndex);
					try {
						const data = JSON.parse(singleJSON);
						onData(data, pair);
					} catch (error) {
						console.error("Error parsing JSON:", error);
					}
					buffer = buffer.slice(newlineIndex + 1);
					newlineIndex = buffer.indexOf("\n");
				}
			}
		} catch (error) {
			console.error("Error in streamData:", error);
		}
	}
	private async makeRequest(
		url: string,
		method: "get" | "post" | "put" = "get",
		expectedStatusCode: number = 200,
		params: any = {},
		data: any = {},
	): Promise<[boolean, any]> {
		let full_url = `${this.oanda_url}/${url}`;

		const headers = {
			Authorization: `Bearer ${this.api_key}`,
			"Content-Type": "application/json",
		};

		const options: RequestInit = {
			method: method.toUpperCase(),
			headers: headers,
		};

		if (method === "get" && Object.keys(params).length > 0) {
			const urlParams = new URLSearchParams(params).toString();
			full_url += `?${urlParams}`;
		} else if (method === "post" || method === "put") {
			options.body = JSON.stringify(data);
		}

		try {
			const response = await fetch(full_url, options);

			if (response.status === expectedStatusCode) {
				const responseData = await response.json();
				return [true, responseData];
			} else {
				const errorData = await response.json();
				return [false, errorData];
			}
		} catch (error) {
			console.error(`Error in makeRequest: ${error}`);
			return [
				false,
				{ error: error instanceof Error ? error.message : "Unknown error" },
			];
		}
	}

	private async getAccountEP(endpoint: string, dataKey: string, accId: string) {
		// Fetch specific endpoint data for a given account ID. Returns the specified data key.
		if (!this.api_key || !this.account_id) {
			console.error("API key or account ID is missing.");
			return null;
		}
		const url = `accounts/${accId}/${endpoint}`;
		const [ok, data] = await this.makeRequest(url);
		if (ok && data[dataKey]) {
			return data[dataKey];
		} else {
			console.error(`ERROR getAccountEP(${endpoint})`, data);
			return null;
		}
	}
	private async getInstrumentEP(endpoint: string, params: any) {
		if (!this.api_key) {
			console.error("API key is missing.");
			return null;
		}
		const url = `instruments/${endpoint}`;
		const [ok, data] = await this.makeRequest(url, "get", 200, params);
		if (ok) {
			return data;
		} else {
			console.error(`ERROR getInstrumentEP(${endpoint})`, data);
			return null;
		}
	}

	public async getAccounts(dataKey: string) {
		// Fetch all accounts. Returns data specified by dataKey.

		const url = "accounts";
		const [ok, data] = await this.makeRequest(url);
		if (ok && data[dataKey]) {
			return data[dataKey];
		} else {
			console.error("ERROR getAccounts()", data);
			return null;
		}
	}
	public async fetchLargeCandles(
		pairName: string,
		total_count: number = 6000,
		granularity: string = "M1",
		price: string = "MBA",
	) {
		if (!this.api_key || !this.account_id) {
			console.error("API key or account ID is missing.");
			return null;
		}
		const maxChunkSize = 500;
		const minutesPerCandle = 1;
		const bufferTime = 60000; // 1 minute buffer to ensure 'toDate' is in the past

		const toDate = new Date(new Date().getTime() - bufferTime); // Subtract buffer time from current time
		const fromDate = new Date(
			toDate.getTime() - total_count * minutesPerCandle * 60000,
		);

		const allCandles: any[] = [];
		let remaining_count = total_count;
		let currentToDate = new Date(toDate);

		while (remaining_count > 0 && fromDate < currentToDate) {
			const chunkSize = Math.min(remaining_count, maxChunkSize);
			let chunkFromDate = new Date(
				currentToDate.getTime() - chunkSize * minutesPerCandle * 60000,
			);

			if (chunkFromDate < fromDate) {
				chunkFromDate = new Date(fromDate);
			}
			const params: any = {
				granularity,
				price,
				from: chunkFromDate.toISOString(),
				to: currentToDate.toISOString(),
			};

			const data = await this.getInstrumentEP(`${pairName}/candles`, params);
			if (data && data["candles"]) {
				const fetchedCandles = data["candles"];
				allCandles.unshift(...fetchedCandles);
				remaining_count -= fetchedCandles.length;
			} else {
				console.error("ERROR fetchLargeCandles()", params, data);
				remaining_count -= chunkSize;
			}

			currentToDate = new Date(chunkFromDate.getTime());
		}

		console.log("Total fetched candles:", allCandles.length);
		return allCandles;
	}

	public async fetchCandles(
		pairName: string,
		count: number = 10,
		granularity: string = "H1",
		price: string = "MBA",
		dateFrom: Date | null = null,
		dateTo: Date | null = null,
	) {
		// Fetch candle data. Returns an array of candle data.

		const url = `instruments/${pairName}/candles`;
		const params: any = {
			granularity,
			price,
		};

		if (dateFrom && dateTo) {
			params.from = dateFrom.toISOString();
			params.to = dateTo.toISOString();
		} else {
			params.count = count;
		}

		const data = await this.getInstrumentEP(`${pairName}/candles`, params);
		if (data && data["candles"]) {
			return data["candles"];
		} else {
			console.error("ERROR fetchCandles()", params, data);
			return null;
		}
	}
	public async getAccountSummary(account_id: string = this.account_id) {
		// Fetch account summary. Returns account summary data.

		return this.getAccountEP("summary", "account", account_id);
	}

	public async getPositionSummary(account_id: string = this.account_id) {
		// Fetch position summary. Returns the first position if available.

		const data = await this.getAccountEP(
			"openPositions",
			"positions",
			account_id,
		);
		if (Array.isArray(data) && data.length > 0) {
			return data[0];
		}
		return null;
	}
	public async getPairPositionSummary(
		pair: string,
		account_id: string = this.account_id,
	) {
		const endpoint = `accounts/${account_id}/positions/${pair}`;
		const [ok, data] = await this.makeRequest(endpoint, "get");
		if (ok) {
			return data.position;
		} else {
			if (data.errorCode === "NO_SUCH_POSITION") {
				console.log(`No position exists for ${pair}`);
				return null;
			} else {
				console.error(`ERROR getPairPositionSummary(${pair})`, data);
				return null;
			}
		}
	}

	// API call to get all positions, filter, and sort them
	public async getAllPositions(account_id: string = this.account_id) {
		const endpoint = `accounts/${account_id}/positions`;
		const [ok, data] = await this.makeRequest(endpoint, "get");
		if (ok && data.positions) {
			const activePositions = data.positions.filter(
				(position: { long: { units: string }; short: { units: string } }) =>
					position.long.units !== "0" || position.short.units !== "0",
			);

			return activePositions;
		} else {
			console.error("Error in getAllPositions", data);
			return [];
		}
	}

	public async getAccountInstruments(account_id: string = this.account_id) {
		// Fetch account instruments. Returns an array of available instruments.

		return this.getAccountEP("instruments", "instruments", account_id);
	}

	public async getAskBid(instrumentsList: string[]) {
		// Fetch ask and bid prices for given instruments. Returns ask and bid prices.

		const url = `accounts/${this.account_id}/pricing`;
		const params = {
			instruments: instrumentsList.join(","),
			includeHomeConversions: true,
		};

		const [ok, response] = await this.makeRequest(url, "get", 200, params);
		if (ok && response["prices"] && response["homeConversions"]) {
			const prices = response["prices"][0];
			return { ask: prices.ask, bid: prices.bid };
		}
		return null;
	}

	public async getClose() {
		// Fetch latest close price. Returns bid price of the latest close candle.

		const url = `accounts/${this.account_id}/candles/latest`;
		const params = {
			candleSpecifications: "EUR_USD:S5:BM",
		};

		const [ok, response] = await this.makeRequest(url, "get", 200, params);
		if (ok && response["latestCandles"]) {
			return response["latestCandles"][0]["candles"][0]["bid"];
		}
		return null;
	}

	public async getFilledOrders(account_id: string = this.account_id) {
		// Fetch filled orders for the account. Returns the latest filled order if available.

		const url = `accounts/${account_id}/orders`;
		const params = {
			state: "ALL",
			count: 1,
		};

		const [ok, response] = await this.makeRequest(url, "get", 200, params);
		if (ok && response["orders"]) {
			const order = response["orders"][0];
			if (order["state"] === "FILLED") {
				return {
					units: order["units"],
					id: order["id"],
					state: order["state"],
				};
			}
		}
		return null;
	}

	public async placeTrade(
		pairName: string,
		units: number,
		direction: number,
		orderType: "MARKET" | "LIMIT" = "MARKET",
		price?: number,
		stopLossPrice?: number,
		takeProfitPrice?: number,
	): Promise<string | null> {
		const url = `accounts/${this.account_id}/orders`;
		units = Math.round(units);
		if (direction === -1) {
			units *= -1;
		}

		// Declare orderData with a flexible type
		const orderData: { [key: string]: any } = {
			units: units.toString(),
			instrument: pairName,
			type: orderType,
		};

		if (orderType === "LIMIT" && price) {
			orderData["price"] = price.toString();
		}

		if (stopLossPrice) {
			orderData["stopLossOnFill"] = {
				price: stopLossPrice.toString(),
				timeInForce: "GTC", // Good Till Cancelled
			};
		}

		if (takeProfitPrice) {
			orderData["takeProfitOnFill"] = {
				price: takeProfitPrice.toString(),
				timeInForce: "GTC", // Good Till Cancelled
			};
		}

		const data = {
			order: orderData,
		};

		const [ok, response] = await this.makeRequest(url, "post", 201, {}, data);
		if (ok && response["orderFillTransaction"]) {
			return response["orderFillTransaction"]["id"];
		}
		return null;
	}

	public async closePosition(pairName: string, units: number) {
		// Close a position. Returns related transaction IDs.

		const url = `accounts/${this.account_id}/positions/${pairName}/close`;
		let data = {};

		if (units > 0) {
			data = { longUnits: "ALL" };
		} else if (units < 0) {
			data = { shortUnits: "ALL" };
		} else {
			// Handle the case where units is zero
			console.error("No position to close");
			return null;
		}

		const [ok, response] = await this.makeRequest(url, "put", 200, {}, data);
		if (ok && response["relatedTransactionIDs"]) {
			return response["relatedTransactionIDs"];
		}
		return null;
	}
}
