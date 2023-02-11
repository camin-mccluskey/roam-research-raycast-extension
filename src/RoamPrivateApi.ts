import {
	createReadStream,
	createWriteStream,
	lstatSync,
	readdirSync,
	readFile,
	realpathSync,
	unlinkSync,
	writeFileSync,
} from 'fs';
import moment from 'moment';
import { Parse, Entry } from 'node-unzip-2';
import { RoamPrivateApiOptions } from './types';
import { tmpdir } from 'os';
import { resolve as _resolve } from 'path';
import { Browser, KnownDevices, launch, Page } from 'puppeteer';


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

	constructor( db: string, login: string, pass: string, options: RoamPrivateApiOptions = { headless: true, folder: '', nodownload: false } ) {
		// If you dont pass folder option, we will use the system tmp directory.
		if (options.folder === '') {
			options.folder = tmpdir();
		}
		options.folder = realpathSync( options.folder );
		this.db = db;
		this.login = login;
		this.pass = pass;
		this.options = options;
	}

  /**
   * Creates a new block in your daily note
   * @param {string} text
   */
  async createDailyNoteBlock(text: string) {
    const dailyNoteUid = this.dailyNoteUid();
    await this.createBlock(text, dailyNoteUid);
  }

	/**
	 * Run a query on the new Roam Alpha API object.
	 * More about the query syntax: https://www.zsolt.blog/2021/01/Roam-Data-Structure-Query.html
	 * @param {string} query - datalog query.
	 */
	async runQuery( query: string ) {
    const { page } = await this.logIn();
		return await page.evaluate( ( query: string ) => {
			if ( ! window.roamAlphaAPI ) {
				return Promise.reject( 'No Roam API detected' );
			}
			const result = window.roamAlphaAPI.q( query );
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
    const { page } = await this.logIn();
		const result = await page.evaluate(
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
	 * Delete blocks matching the query. Has some protections, but
	 * THIS IS VERY UNSAFE. DO NOT USE THIS IF YOU ARE NOT 100% SURE WHAT YOU ARE DOING
	 * @param {string} query - datalog query to find blocks to delete. Has to return block uid.
	 * @param {int} limit - limit deleting to this many blocks. Default is 1.
	 */
	async deleteBlocksMatchingQuery( query: string, limit: number ) {
    const { page } = await this.logIn();
		if ( ! limit ) {
			limit = 1;
		}
		return await page.evaluate(
			( query: string, limit: number ) => {
				if ( ! window.roamAlphaAPI ) {
					return Promise.reject( 'No Roam API detected' );
				}
				const result = window.roamAlphaAPI.q( query );
				console.log( result );
				if ( result.length > 100 ) {
					return Promise.reject( 'Too many results. Is your query ok?' );
				}
				const limited = result.slice( 0, limit );
				limited.forEach( ( block: any ) => {
					const id = block[ 0 ];
					console.log( 'DELETING', id );
					window.roamAlphaAPI.deleteBlock( { block: { uid: id } } );
				} );
				return Promise.resolve( limited );
			},
			query,
			limit
		);
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
	 * When importing in Roam, import leaves an "Import" block.
	 * This removes that from your daily page.
	 * THIS IS UNSAFE since it deletes blocks.
	 */
	async removeImportBlockFromDailyNote() {
    const { page } = await this.logIn();
		await this.deleteBlocksMatchingQuery(
			this.getQueryToFindBlocksOnPage( 'Import', this.dailyNoteTitle() ),
			1
		);
		//Lets give time to sync
		await page.waitForTimeout( 1000 );
		return;
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
	 * Export your Roam database and return the JSON data.
	 * @param {boolean} autoremove - should the zip file be removed after extracting?
	 */
	async getExportData( autoremove: boolean ) {
		// Mostly for testing purposes when we want to use a preexisting download.
		if ( ! this.options.nodownload ) {
			await this.logIn();
			await this.downloadExport( this.options.folder );
		}
		const latestExport = this.getLatestFile( this.options.folder );
		const content = await this.getContentsOfRepo( this.options.folder, latestExport );
		if ( autoremove ) {
			unlinkSync( latestExport );
		}
		await this.close();
		return content;
	}
	/**
	 * Logs in to Roam interface. Returns browser and page objects.
	 */
	async logIn(): Promise<{ browser: Browser, page: Page }> {
		if ( this.browser && this.page ) {
			return { browser: this.browser, page: this.page};
		}    
		this.browser = await launch( this.options );
		try {
			this.page = await this.browser.newPage();
			this.page.setDefaultTimeout( 60000 );
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
			throw e;
		}
		// Login
		await this.page.type( 'input[name=email]', this.login );
		await this.page.type( 'input[name=password]', this.pass );
		await this.page.click( '.bp3-button' );
		await this.page.waitForSelector( '.bp3-icon-more' );
		return {browser: this.browser, page: this.page};
	}

	/**
	 * Import blocks to your Roam graph
	 * @see examples/import.js.
	 * @param {array} items
	 */
	async import( items = [] ) {
		const fileName = _resolve( this.options.folder, 'roam-research-private-api-sync.json' );
		writeFileSync( fileName, JSON.stringify( items ) );
		const { page } = await this.logIn();
		await page.waitForSelector( '.bp3-icon-more' );
		await this.clickMenuItem( 'Import Files' );
		// await page.click( '.bp3-icon-more' );
		// // This should contain "Export All"
		// await page.waitFor( 2000 );
		// await page.click( '.bp3-menu :nth-child(5) a' );
		await page.waitForSelector( 'input[type=file]' );
		await page.waitForTimeout( 1000 );
		// get the ElementHandle of the selector above
		const inputUploadHandle = await page.$( 'input[type=file]' );

		// Sets the value of the file input to fileToUpload
    if (!inputUploadHandle) {
      console.error('Cannot find the file input!')
      return;
    }
		inputUploadHandle.uploadFile( fileName );
		await page.waitForSelector( '.bp3-dialog .bp3-intent-primary' );
		await page.click( '.bp3-dialog .bp3-intent-primary' );
		await page.waitForTimeout( 3000 );
		await this.removeImportBlockFromDailyNote();
		return;
	}

	/**
	 * Inserts text to your quickcapture.
	 * @param {string} text
	 */
	async quickCapture( text: string | string[] = [] ) {
		const { browser } = await this.logIn();
		const page = await browser.newPage();
		await page.emulate( KnownDevices[ 'iPhone X' ] );
		// set user agent (override the default headless User Agent)
		await page.goto( 'https://roamresearch.com/#/app/' + this.db );

		await page.waitForSelector( '#block-input-quick-capture-window-qcapture' );
		if (typeof(text) === 'string') {
			text = [ text ];
		}

		text.forEach( async function ( t ) {
			await page.type( '#block-input-quick-capture-window-qcapture', t );
			await page.click( 'button.bp3-intent-primary' );
		} );
		await page.waitForTimeout( 500 );
		// page.close();
		await this.close();
		return;
	}

	/**
	 * Click item in the side-menu. This is mostly internal.
	 * @param {string} title
	 */
	async clickMenuItem( title: string ) {
    const { page } = await this.logIn();
		await page.click( '.bp3-icon-more' );
		// This should contain "Export All"
		await page.waitForTimeout( 1000 );
		await page.evaluate( ( title: string ) => {
			const items = [ ...document.querySelectorAll<HTMLElement>( '.bp3-menu li a' ) ];
			items.forEach( ( item ) => {
				if ( item.innerText === title ) {
					item.click();
					return;
				}
			} );
		}, title );
	}

	/**
	 * Download Roam export to a selected folder.
	 * @param {string} folder
	 */
	async downloadExport( folder: string ) {
    const { page } = await this.logIn();
    // @ts-ignore
		await page._client.send( 'Page.setDownloadBehavior', {
			behavior: 'allow',
			downloadPath: folder,
		} );
		// Try to download
		// await page.goto( 'https://roamresearch.com/#/app/' + this.db );
		// await page.waitForNavigation();
		await page.waitForSelector( '.bp3-icon-more' );
		await this.clickMenuItem( 'Export All' );
		// await page.click( '.bp3-icon-more' );
		// // This should contain "Export All"
		// await page.waitFor( 2000 );
		// await page.click( '.bp3-menu :nth-child(4) a' );
		//Change markdown to JSON:
		// This should contain markdown
		await page.waitForTimeout( 2000 );
		await page.click( '.bp3-dialog-container .bp3-popover-wrapper button' );
		// This should contain JSON
		await page.waitForTimeout( 2000 );
		await page.click( '.bp3-dialog-container .bp3-popover-wrapper .bp3-popover-dismiss' );
		// This should contain "Export All"
		await page.waitForTimeout( 2000 );
		await page.click( '.bp3-dialog-container .bp3-intent-primary' );

		await page.waitForTimeout( 60000 ); // This can take quite some time on slower systems
		// Network idle is a hack to wait until we donwloaded stuff. I don't think it works though.
		await page.goto( 'https://news.ycombinator.com/', { waitUntil: 'networkidle2' } );
		return;
	}

	/**
	 * Close the fake browser session.
	 */
	async close() {
		if ( this.browser ) {
			await this.page?.waitForTimeout( 1000 );
			await this.browser.close();
			this.browser = undefined;
		}
		return;
	}

	/**
	 * Get the freshest file in the directory, for finding the newest export.
	 * @param {string} dir
	 */
	getLatestFile( dir: string ) {
		const orderReccentFiles = ( dir: string ) =>
			readdirSync( dir )
				.filter(
					( f ) => lstatSync( _resolve( dir, f ) ) && lstatSync( _resolve( dir, f ) ).isFile()
				)
				.filter( ( f ) => f.indexOf( 'Roam-Export' ) !== -1 )
				.map( ( file ) => ( { file, mtime: lstatSync( _resolve( dir, file ) ).mtime } ) )
				.sort( ( a, b ) => b.mtime.getTime() - a.mtime.getTime() );

		const getMostRecentFile = ( dir: string ) => {
			const files = orderReccentFiles( dir );
			return files.length ? files[ 0 ] : undefined;
		};
    const mostRecentFile = getMostRecentFile(dir) || { file: '' };
		return _resolve( dir, mostRecentFile.file );
	}

	/**
	 * Unzip the export and get the content.
	 * @param {string} dir
	 * @param {string} file
	 */
	getContentsOfRepo( dir: string, file: string ) {
		return new Promise( ( resolve, reject ) => {
			const stream = createReadStream( file ).pipe( Parse() );
			stream.on( 'entry', function ( entry: Entry ) {
				const fileName = entry.path;
				if ( fileName.indexOf( '.json' ) != -1 ) {
					entry.pipe( createWriteStream( _resolve( dir, 'db.json' ) ) );
				} else {
					entry.autodrain();
				}
			} );
			// Timeouts are here so that the system locks can be removed - takes time on some systems.
			stream.on( 'close', function () {
				setTimeout( function () {
					readFile( _resolve( dir, 'db.json' ), 'utf8', function ( err, data ) {
						if ( err ) {
							reject( err );
						} else {
							resolve( JSON.parse( data ) );
						}
					} );
				}, 1000 );
			} );
		} );
	}
}

export default RoamPrivateApi;
