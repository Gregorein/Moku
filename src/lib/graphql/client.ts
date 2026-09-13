import { authHeaders } from '$lib/state/auth.svelte'

export class GraphQLError extends Error {
	code?: string
	grpc?: string
	constructor(message: string, public errors: unknown[]) {
		super(message)
		this.name = 'GraphQLError'
		const ext = (errors[0] as { extensions?: { code?: string; grpc?: string } } | undefined)?.extensions
		this.code = ext?.code
		this.grpc = ext?.grpc
	}
}

export class AuthRequiredError extends Error {
	constructor() {
		super('Authentication required')
		this.name = 'AuthRequiredError'
	}
}

export async function gql<T>(
	query: string,
	variables: Record<string, unknown> | undefined,
	baseUrl: string,
	signal?: AbortSignal,
): Promise<T> {
	const res = await fetch(`${baseUrl}/api/graphql`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...authHeaders() },
		body: JSON.stringify({ query, variables }),
		signal,
	})

	if (res.status === 401) {
		throw new AuthRequiredError()
	}

	if (!res.ok) {
		throw new Error(`GraphQL request failed: HTTP ${res.status}`)
	}

	const json = await res.json()

	if (json.errors?.length) {
		throw new GraphQLError(json.errors[0]?.message ?? 'GraphQL error', json.errors)
	}

	return json.data as T
}
