interface JobListener {
	onJobCompleted(id: string, name: string, result: any): void;
}

export default JobListener;
