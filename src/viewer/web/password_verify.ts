
/**
 * PasswordPrompt，密码管理器
 */
export class PasswordVerify {

  constructor() {

  }

  /**
   * 实现一个怎样的密码管理器，我是不关心的，我只关心密码的具体实现方法。
   * 我只要用户传递过来的密码，这种密码甚至可以直接是在url里的。不然假设出了这种场景：
   * 有的用户自带密码，有的用户需要拿到密码才可以查看，这个应当如何解？
   * 或者手机上一种密码输入方式，PC上一种密码输入方式。
   */
  async password(_pwd: string): Promise<boolean> {
    return true
  }

  async open() {

  }

  async close() {

  }
}

