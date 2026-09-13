import { platformService } from '$lib/platform-service'

const TOKEN_CREDENTIAL_KEY = 'serverAuthToken'

export const authState = $state({
	token: null as string | null,
})

export async function loadPersistedToken(): Promise<void> {
	try {
		authState.token = await platformService.getCredential(TOKEN_CREDENTIAL_KEY)
	} catch {
		authState.token = null
	}
}

export async function setAuthToken(token: string): Promise<void> {
	authState.token = token
	try {
		await platformService.storeCredential(TOKEN_CREDENTIAL_KEY, token)
	} catch {}
}

export async function clearAuthToken(): Promise<void> {
	authState.token = null
	try {
		await platformService.storeCredential(TOKEN_CREDENTIAL_KEY, '')
	} catch {}
}

export function authHeaders(): Record<string, string> {
	return authState.token ? { Authorization: `Bearer ${authState.token}` } : {}
}
