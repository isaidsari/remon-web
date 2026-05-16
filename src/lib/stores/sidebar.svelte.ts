class SidebarStore {
	open = $state(false);

	toggle(): void {
		this.open = !this.open;
	}

	close(): void {
		this.open = false;
	}
}

export const sidebar = new SidebarStore();
