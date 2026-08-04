import type {
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IPollFunctions,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

const BASE_URL = 'https://app.personyze.com/rest';

/**
 * Polling, not instant.
 *
 * An instant trigger would need Personyze to POST to a URL n8n generates, and
 * that means a subscription registry the backend does not have. Polling on
 * `data_last_modified` is the honest version: the column is maintained by a
 * database trigger on every write and is indexed, so the query below is served
 * from an index rather than scanning the profile table.
 */
export class PersonyzeTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Personyze Trigger',
		name: 'personyzeTrigger',
		icon: { light: 'file:personyze.svg', dark: 'file:personyze.dark.svg' },
		group: ['trigger'],
		version: 1,
		description: 'Starts the workflow when a Personyze visitor profile is created or changed',
		subtitle: '={{ "Visitor changed" }}',
		defaults: { name: 'Personyze Trigger' },
		polling: true,
		usableAsTool: true,
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'personyzeApi', required: true }],
		properties: [
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 50,
				description: 'Max number of results to return',
				hint: 'Personyze serves an incremental read 50 rows at a time, so a higher value has no effect.',
			},
		],
	};

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const staticData = this.getWorkflowStaticData('node');
		// A `where` range condition makes the query "slow" to the API, which then
		// refuses to read past 50 rows however it is ordered -- so the poll asks
		// for at most 50 even when the user sets a higher limit. Anything above
		// that came back as a bare 400 and the trigger simply stopped firing.
		const limit = Math.min(this.getNodeParameter('limit', 50) as number, 50);
		const now = Math.floor(Date.now() / 1000);
		const since = staticData.lastTimeChecked as number | undefined;
		const manual = this.getMode() === 'manual';

		// On a manual run there is no window to ask about -- the user wants to see
		// the shape of the data, so hand back the most recent record and leave the
		// stored watermark alone. Advancing it here would silently skip whatever
		// changed between now and the first scheduled poll.
		const url = manual
			? `${BASE_URL}/users/order_by_desc/data_last_modified/limit/0,1`
			: `${BASE_URL}/users/where/data_last_modified>${since ?? now}/order_by/data_last_modified/limit/0,${limit}`;

		const response = (await this.helpers.httpRequestWithAuthentication.call(this, 'personyzeApi', {
			method: 'GET',
			url,
			json: true,
		})) as IDataObject[];

		if (!manual) {
			// Advance from the newest row actually seen, not from the wall clock. A
			// visitor written while the request was in flight would otherwise fall
			// into the gap between the two and never be emitted.
			const newest = response.reduce(
				(max, row) => Math.max(max, Number(row.data_last_modified) || 0),
				since ?? now,
			);
			staticData.lastTimeChecked = response.length ? newest : now;
		}

		if (Array.isArray(response) && response.length) {
			return [this.helpers.returnJsonArray(response)];
		}

		return null;
	}
}
