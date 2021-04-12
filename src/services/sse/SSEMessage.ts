type SSEMessage = {
	id?: string;
	type?: string;
	retry?: string;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	data: any;
};

export default SSEMessage;
