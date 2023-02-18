import { realpathSync } from 'fs';
import moment from 'moment';
import { RoamPrivateApiOptions } from './types';
import { tmpdir } from 'os';
import { Browser, launch, Page } from 'puppeteer';


/**
 * This class represents wraps Puppeteer and exposes a few methods useful in manipulating Roam Research.
 */
class RoamPrivateApi {
	options: RoamPrivateApiOptions;
  browser: Browser | undefined;
  page: Page | undefined;
	db: string;
	login: string;
	pass: string;
  initCallback: (roamPrivateApi: RoamPrivateApi) => void;
  loggingIn = false;

	constructor( db: string, login: string, pass: string, initCallback: (roamPrivateApi: RoamPrivateApi) => void,
  options: RoamPrivateApiOptions = { headless: true, folder: '', nodownload: false } ) {
		// If you dont pass folder option, we will use the system tmp directory.
		if (options.folder === '') {
			options.folder = tmpdir();
		}
		options.folder = realpathSync( options.folder );
		this.db = db;
		this.login = login;
		this.pass = pass;
		this.options = options;
    this.initCallback = initCallback;
    this.logIn();
	}

  /**
   * Creates a new block in your daily note
   * @param {string} text
   */
  async createDailyNoteBlock(text: string) {
    const dailyNoteUid = this.dailyNoteUid();
    await this.createBlock(text, dailyNoteUid);
  }

  async getAllBlocksOnDailyNote() {
    await this.logIn();
    if (!this.page) {
      throw new Error('No page found');
    }
    const pageTitle = this.dailyNoteTitle();
    return await this.page.evaluate((pageTitle: string) => {
      return window.roamAlphaAPI.q(`[ 
        :find (pull ?e [ 
          :node/title 
          :block/string 
          :block/children
          {:block/children ...} 
        ])
        :in $ ?pageTitle
        :where [?e :node/title ?pageTitle]]`,
        pageTitle
      )[0][0]
    }, pageTitle);
  }  

	/**
	 * Run a query on the new Roam Alpha API object.
	 * More about the query syntax: https://www.zsolt.blog/2021/01/Roam-Data-Structure-Query.html
	 * @param {string} query - datalog query.
	 */
	async runQuery( query: string ) {
    await this.logIn();
    if (!this.page) {
      throw new Error('No page found');
    }
		return await this.page.evaluate( ( query: string ) => {
			if ( ! window.roamAlphaAPI ) {
				return Promise.reject( 'No Roam API detected' );
			}
			const result = window.roamAlphaAPI.q(query);
			console.log( result );
			return Promise.resolve( result );
		}, query );
	}

	/**
	 * Create a block as a child of block.
	 * @param {string} text
	 * @param {uid} uid - parent UID where block has to be inserted.
	 */
	async createBlock( text: string, uid: string ) {
    await this.logIn();
    if (!this.page) {
      throw new Error('No page found');
    }
		const result = await this.page.evaluate(
			( text: string, uid: string ) => {
				if ( ! window.roamAlphaAPI ) {
					return Promise.reject( 'No Roam API detected' );
				}
				const result = window.roamAlphaAPI.createBlock( {
					location: { 'parent-uid': uid, order: 0 },
					block: { string: text },
				} );
				return Promise.resolve( result );
			},
			text,
			uid
		);
		// Let's give time to sync.
		// await page.waitForTimeout( 1000 );
		return result;
	}

	/**
	 * Returns a query to find blocks with exact text on the page with title.
	 * Useful with conjuction with deleteBlocksMatchingQuery,
	 * @param {string} text - Exact text in the block.
	 * @param {*} pageTitle - page title to find the blocks in.
	 */
	getQueryToFindBlocksOnPage( text: string, pageTitle: string ) {
		text = text.replace( '"', '"' );
		pageTitle = pageTitle.replace( '"', '"' );

		return `[:find ?uid
			:where [?b :block/string "${ text }"]
				   [?b :block/uid  ?uid]
				   [?b :block/page ?p]
				   [?p :node/title "${ pageTitle }"]]`;
	}

	/**
	 * Returns datalog query to find all blocks containing the text.
	 * Returns results in format [[ blockUid, text, pageTitle ]].
	 * @param {string} text - text to search.
	 */
	getQueryToFindBlocks( text: string ) {
		text = text.replace( '"', '"' );
		return `[:find ?uid ?string ?title :where
			[?b :block/string ?string]
			[(clojure.string/includes? ?string "${ text }")]
			[?b :block/uid  ?uid]
			[?b :block/page ?p]
			[?p :node/title ?title]
		]`;
	}

	/**
	 * Return page title for the current daily note.
	 */
	dailyNoteTitle() {
		return moment( new Date() ).format( 'MMMM Do, YYYY' );
	}
	/**
	 * Return page uid for the current daily note.
	 */
	dailyNoteUid() {
		return moment( new Date() ).format( 'MM-DD-YYYY' );
	}

	/**
	 * Logs in to Roam interface
	 */
	async logIn() {
    // already logged in
    if (this.page && await this.page.evaluate(() => !!window.roamAlphaAPI)) return;
    // waiting for login to finish
    if (this.loggingIn) {
      while (this.loggingIn) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      return;
    }
    this.loggingIn = true;
		this.browser = await launch(this.options);
		try {
			this.page = await this.browser.newPage();
			this.page.setDefaultTimeout(60000);
      // disabled images, fonts and stylesheets
      await this.page.setRequestInterception(true);
      this.page.on('request', (req) => {
        if(req.resourceType() == 'stylesheet' || req.resourceType() == 'font' || req.resourceType() == 'image') {
          req.abort();
        }
        else {
          req.continue();
        }
      });

			await this.page.goto( 'https://roamresearch.com/#/app/' + this.db,  { waitUntil: 'domcontentloaded' } );
			await this.page.waitForNavigation({ waitUntil: 'domcontentloaded' });
			await this.page.waitForSelector( 'input[name=email]' );
		} catch ( e ) {
			console.error( 'Cannot load the login screen!' );
      this.loggingIn = false;
			throw e;
		}
		// Login
		await this.page.type( 'input[name=email]', this.login );
		await this.page.type( 'input[name=password]', this.pass );
		await this.page.click( '.bp3-button' );
		await this.page.waitForSelector( '.bp3-icon-more' );
    this.loggingIn = false;
    this.initCallback(this);
	}
}

export default RoamPrivateApi;
