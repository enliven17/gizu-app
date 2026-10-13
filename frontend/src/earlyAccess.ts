type InvitationRequest = {
  email: string
  investmentRange?: string
  platforms?: string[]
  otherPlatform?: string
}

export async function requestInvitation(input: InvitationRequest, apiUrl: string): Promise<void> {
  const response = await fetch(`${apiUrl.replace(/\/$/, '')}/v1/early-access`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => { throw new Error('We couldn’t save your email. Check your connection and try again.') })
  if (!response.ok) {
    throw new Error(response.status === 429
      ? 'Too many attempts. Please wait a minute and try again.'
      : 'We couldn’t save your email. Please try again.')
  }
  const result: unknown = await response.json().catch(() => null)
  if (!result || typeof result !== 'object' || !('status' in result) || result.status !== 'registered') {
    throw new Error('We couldn’t confirm your signup. Please try again.')
  }
}
