
/**
 * PageViewManager会通过API创建一个个div，这些div对应一个个PDF页面。
 * 
 */
export interface PageViewArrange {

  appendPage(pageNum: number, div: HTMLDivElement): void;

  pageUp(): void;

  pageDown(): void;

}

export class ScrollViewArrange implements PageViewArrange {

  protected container: HTMLDivElement;

  protected pageMap: Map<number, HTMLDivElement>;

  constructor(container: HTMLDivElement) {
    this.container = container;
    this.pageMap = new Map();
  }

  appendPage(pageNum: number, div: HTMLDivElement): void {
    if (this.pageMap.has(pageNum)) {
      throw new Error("不能够重复添加同一个页面");
    }
    this.pageMap.set(pageNum, div);
    this.container.append(div);
  }

  pageUp(): void {

  }

  pageDown(): void {

  }
}

export class FlipViewArrange implements PageViewArrange {

  protected container: HTMLDivElement;

  // 从第一页开始
  protected currPageNumLeft = 1;

  protected currPageNumRight = 2;

  protected pageMap = new Map<number, HTMLDivElement>();

  protected minPage = Infinity;

  protected maxPage = 0;

  protected leftContainer: HTMLDivElement;

  protected rightContainer: HTMLDivElement;

  constructor(container: HTMLDivElement) {
    this.container = container;
    const left = document.createElement('div');
    left.style.width = 'auto'
    left.style.height = 'auto'
    left.style.display = 'inline-block'
    left.style.border = '1px solid'
    const right = document.createElement('div');
    right.style.width = 'auto'
    right.style.height = 'auto'
    right.style.display = 'inline-block'
    right.style.marginLeft = '20px'
    right.style.border = '1px solid'
    this.container.append(left);
    this.container.append(right);
    this.leftContainer = left;
    this.rightContainer = right;
  }

  appendPage(pageNum: number, div: HTMLDivElement): void {
    if (this.maxPage < pageNum) {
      this.maxPage = pageNum;
    }
    if (this.minPage > pageNum) {
      this.minPage = pageNum;
    }
    if (this.pageMap.has(pageNum)) {
      throw new Error("不能够重复添加同一个页面");
    }
    this.pageMap.set(pageNum, div);
    if (pageNum == this.currPageNumLeft) {
      this.leftContainer.append(div);
    }
    if (pageNum == this.currPageNumRight) {
      this.rightContainer.append(div);
    }
  }

  pageUp(): void {
    if (this.adjustPage(-2)) {
      this.switchPage();
    }
  }

  pageDown(): void {
    if (this.adjustPage(2)) {
      this.switchPage();
    }
  }

  protected adjustPage(delta: number) {
    const newLeft = this.currPageNumLeft + delta;
    if (newLeft > this.maxPage || newLeft < this.minPage) {
      return false;
    }
    this.currPageNumLeft = newLeft;
    if(newLeft + 1 <= this.maxPage){
      this.currPageNumRight = newLeft + 1;
    }
    return true;
  }

  switchPage() {
    if (this.currPageNumLeft < this.minPage || this.currPageNumRight > this.maxPage) {
      return;
    }
    const left = this.leftContainer;
    const right = this.rightContainer;
    if (left.firstChild) {
      left.removeChild(left.firstChild!);
    }
    if (right.firstChild) {
      right.removeChild(right.firstChild);
    }
    left.append(this.pageMap.get(this.currPageNumLeft)!);
    right.append(this.pageMap.get(this.currPageNumRight)!);
  }
}