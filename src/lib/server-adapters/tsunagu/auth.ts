import { gql, baseUrl } from './gql'

export const auth = {
	async login(password: string): Promise<{ token: string; expiresAt: string }> {
		const res = await fetch(`${baseUrl()}/api/auth/login`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ password }),
		})
		if (!res.ok) throw new Error(res.status === 401 ? 'Incorrect password' : `HTTP ${res.status}`)
		return res.json()
	},

	async authStatus(): Promise<{ passwordSet: boolean }> {
		const data = await gql<{ authStatus: { passwordSet: boolean } }>(
			`query AuthStatus { authStatus { passwordSet } }`,
			undefined,
			baseUrl(),
		)
		return data.authStatus
	},

	async setPassword(newPassword: string): Promise<boolean> {
		const data = await gql<{ setPassword: boolean }>(
			`mutation SetPassword($newPassword: String!) {
				setPassword(newPassword: $newPassword)
			}`,
			{ newPassword },
			baseUrl(),
		)
		return data.setPassword
	},

	async disableServerAuth(): Promise<boolean> {
		const data = await gql<{ disableServerAuth: boolean }>(
			`mutation DisableServerAuth { disableServerAuth }`,
			undefined,
			baseUrl(),
		)
		return data.disableServerAuth
	},
}
