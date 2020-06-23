import * as mongo from "mongodb"
import * as authly from "authly"
import { Document } from "./Document"
import { Filter } from "./Filter"
import { Update } from "./Update"

export class Collection<T extends Document> {
	private hexadecmialIdLength: number
	constructor(private backend: mongo.Collection, readonly shard?: string, readonly idLength: 4 | 8 | 12 | 16 = 16) {
		this.hexadecmialIdLength = idLength * 3 / 2
	}
	async get(filter: Filter<T>): Promise<T | undefined> {
		if (Document.is(filter))
			filter = this.fromDocument(filter)
		return this.toDocument(await this.backend.findOne(filter))
	}
	async list(filter?: Filter<T>): Promise<T[]> {
		if (Document.is(filter))
			filter = this.fromDocument(filter)
		return this.backend.find(filter).map<T>(this.toDocument.bind(this)).toArray()
	}
	async create(document: T): Promise<T>
	async create(documents: T[]): Promise<T[]>
	async create(documents: T | T[]): Promise<T | T[]> {
		let result: T | T[]
		if (Array.isArray(documents)) {
			const r = await this.backend.insertMany(documents.map(this.fromDocument.bind(this)))
			result = await (this.backend.find({ _id: { $in: Object.values(r.insertedIds) } })).map(d => this.toDocument(d)).toArray()
		} else {
			const r = await this.backend.insertOne(this.fromDocument(documents))
			result = this.toDocument(await this.backend.find(r.insertedId).next() || undefined)
		}
		return result
	}
	async update(document: Filter<T> & Update<T> & Document): Promise<T | undefined>
	async update(document: Filter<T> & Update<T>): Promise<T | number | undefined>
	async update(documents: (Filter<T> & Update<T>)[]): Promise<T[]>
	async update(documents: Filter<T> & Update<T> | (Filter<T> & Update<T>)[]): Promise<T | number | undefined | T[]> {
		let result: T | undefined | T[] | number
		if (Array.isArray(documents))
			result = (await Promise.all(documents.map(document => this.update(document)))).filter(r => r != undefined) as T[]
		else {
			const filter: { _id?: mongo.ObjectID, [property: string]: string | undefined | mongo.ObjectID } = this.fromDocument(Filter.toMongo(documents, "id", this.shard))
			const update: { $push?: { [field: string]: { $each: any[] } }, $set?: { [field: string]: any } } = Update.toMongo(documents, "id", this.shard)
			if (filter._id) {
				const updated = await this.backend.findOneAndUpdate(filter, update, { returnOriginal: false })
				result = updated.ok ? this.toDocument(updated.value) : undefined
			} else {
				const shard = this.shard
				result = shard && !filter[shard] // Workaround for CosmosDB:s lack of support for updateMany across shards, slow
					? (await Promise.all([...new Set(await this.backend.find(filter).map(d => d[shard]).toArray())].map(async s => (await this.backend.updateMany(filter, update, {})).matchedCount))).reduce((r, c) => r + c, 0)
					: (await this.backend.updateMany(filter, update, {})).modifiedCount
			}
		}
		return result
	}
	private toBase64(id: mongo.ObjectID): authly.Identifier {
		return authly.Identifier.fromHexadecimal(id.toHexString().slice(24 - this.hexadecmialIdLength))
	}
	private toBase16(id: authly.Identifier): mongo.ObjectID {
		return new mongo.ObjectID(authly.Identifier.toHexadecimal(id).padStart(24, "0").slice(0, 24))
	}
	private toDocument(document: { _id: mongo.ObjectID }): T
	private toDocument(document: { _id: mongo.ObjectID } | undefined | null): T | undefined
	private toDocument(document: { _id: mongo.ObjectID } | undefined | null): T | undefined {
		let result: T | undefined
		if (document) {
			const id = this.toBase64(document._id)
			delete(document._id)
			result = { ...document, id } as any
		}
		return result
	}
	private fromDocument(document: Partial<Document>): any {
		const result: any = { ...document }
		if (document.id)
			result._id = new mongo.ObjectID(this.toBase16(document.id))
		delete(result.id)
		return result
	}
}
