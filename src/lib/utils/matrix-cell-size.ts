/**
 * Measures table cells and computes optimal uniform cell dimensions to fit a container.
 * Used by MatrixView and OperationsMatrixView.
 *
 * Temporarily switches the table to `table-layout: auto` during measurement so that
 * cells can expand to their natural content width (fixed layout prevents this).
 *
 * @param scrollEl - The scrollable container element
 * @param tableEl - The table element
 * @param numCols - Total number of columns (including header)
 * @param numRows - Total number of rows (including header)
 * @returns Computed cell dimensions, or null if measurement isn't possible.
 *   - `width`: minimum width for data columns (driven by `tbody td` content)
 *   - `headerWidth`: minimum width for the row-header column (driven by `tbody th` content)
 *   - `height`: uniform row height
 */
export function measureCellSize(
	scrollEl: HTMLElement,
	tableEl: HTMLTableElement,
	numCols: number,
	numRows: number
): { width: number; height: number; headerWidth: number } | null {
	if (!scrollEl || !tableEl) return null;
	if (numCols <= 0 || numRows <= 0) return null;

	const headerCells = tableEl.querySelectorAll('tbody th');
	const dataCells = tableEl.querySelectorAll('tbody td');
	const bodyCells = tableEl.querySelectorAll('tbody th, tbody td');
	let maxDataWidth = 0;
	let maxHeaderWidth = 0;
	let maxHeight = 0;

	// Save table layout and switch to auto so cells size to content
	const savedTableLayout = tableEl.style.tableLayout;
	const savedTableWidth = tableEl.style.width;
	tableEl.style.tableLayout = 'auto';
	tableEl.style.width = 'auto';

	// Batch: save cell styles and set to auto for measurement
	type SavedStyle = { el: HTMLElement; w: string; min: string; max: string; ws: string };
	const visited = new Set<HTMLElement>();
	const saved: SavedStyle[] = [];

	const prepCell = (el: HTMLElement) => {
		if (visited.has(el)) return;
		visited.add(el);
		saved.push({
			el,
			w: el.style.width,
			min: el.style.minWidth,
			max: el.style.maxWidth,
			ws: el.style.whiteSpace
		});
		el.style.width = 'auto';
		el.style.minWidth = 'auto';
		el.style.maxWidth = 'none';
		el.style.whiteSpace = 'nowrap';
	};

	bodyCells.forEach((c) => prepCell(c as HTMLElement));

	// Single reflow for all measurements
	void tableEl.offsetWidth;

	// Read widths from data cells (drives data column minimum)
	dataCells.forEach((cell) => {
		maxDataWidth = Math.max(maxDataWidth, (cell as HTMLElement).getBoundingClientRect().width);
	});

	// Read widths from header cells (drives header column minimum)
	headerCells.forEach((cell) => {
		maxHeaderWidth = Math.max(maxHeaderWidth, (cell as HTMLElement).getBoundingClientRect().width);
	});

	// Read heights from body cells (avoid inflated header heights from vertical text)
	bodyCells.forEach((cell) => {
		maxHeight = Math.max(maxHeight, (cell as HTMLElement).getBoundingClientRect().height);
	});

	// Restore all styles
	for (const { el, w, min, max, ws } of saved) {
		el.style.width = w;
		el.style.minWidth = min;
		el.style.maxWidth = max;
		el.style.whiteSpace = ws;
	}
	tableEl.style.tableLayout = savedTableLayout;
	tableEl.style.width = savedTableWidth;

	const containerWidth = scrollEl.clientWidth;
	const containerHeight = scrollEl.clientHeight;

	// Header row has its own fixed height (via CSS !important), so subtract it
	const thead = tableEl.querySelector('thead');
	const headerHeight = thead?.getBoundingClientRect()?.height ?? 0;
	const numBodyRows = Math.max(numRows - 1, 1);
	const availableHeight = containerHeight - headerHeight;

	// getBoundingClientRect() returns border-box dimensions; table cells use
	// box-sizing: border-box so setting CSS width/height to these values keeps
	// the same total size — no separate border correction needed.
	const numDataCols = numCols - 1; // exclude header column

	// Available width for data columns after subtracting header column
	const availableDataWidth = containerWidth - maxHeaderWidth;
	const fitDataWidth = numDataCols > 0 ? Math.floor(availableDataWidth / numDataCols) : 0;

	const finalWidth = Math.max(maxDataWidth, fitDataWidth);
	// Add a small guard band: browser table measurement can be exact while
	// sticky row headers still lose a few pixels to borders, padding, and KaTeX
	// subscript boxes. Without this, labels such as dec-SDNNF_T can clip.
	const finalHeaderWidth = Math.ceil(maxHeaderWidth) + 8;
	const finalHeight = Math.max(maxHeight, Math.floor(availableHeight / numBodyRows));

	return { width: finalWidth, height: finalHeight, headerWidth: finalHeaderWidth };
}
