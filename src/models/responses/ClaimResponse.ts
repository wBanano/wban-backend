enum ClaimResponse {
	Ok,
	AlreadyDone,
	InvalidSignature,
	InvalidOwner,
	Error,
	Blacklisted,
}

export { ClaimResponse };
