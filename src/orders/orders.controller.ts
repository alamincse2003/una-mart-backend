import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Auth, CurrentUser } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/session.js';
import { cartOwner } from '../cart/cart-owner.js';
import { CartService } from '../cart/cart.service.js';
import {
  CreateOrderDto,
  CustomerOrderDto,
  MyOrdersQuery,
  OrderLookupQuery,
  OrderSummaryPageDto,
} from './orders.dto.js';
import { OrdersService } from './orders.service.js';

const MINUTE = 60_000;

@ApiTags('Orders')
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly cart: CartService,
  ) {}

  /** COD checkout from the current cart (guest cookie or logged-in user). */
  @Post()
  @Throttle({ default: { limit: 10, ttl: MINUTE } })
  @ApiCreatedResponse({ type: CustomerOrderDto })
  async create(
    @Req() req: Request,
    @Body() body: CreateOrderDto,
    @CurrentUser() user: AuthUser | null,
  ): Promise<CustomerOrderDto> {
    return this.orders.createOrder(await this.cart.findCartId(cartOwner(req)), body, user);
  }

  /** My orders, newest first. */
  @Get()
  @Auth()
  @ApiOkResponse({ type: OrderSummaryPageDto })
  mine(@CurrentUser() user: AuthUser, @Query() query: MyOrdersQuery): Promise<OrderSummaryPageDto> {
    return this.orders.listMine(user, query.page, query.pageSize);
  }

  /** Owner (logged in), or guest with order number + the phone it was placed with. */
  @Get(':number')
  @Throttle({ default: { limit: 20, ttl: MINUTE } })
  @ApiOkResponse({ type: CustomerOrderDto })
  find(
    @Param('number') orderNumber: string,
    @Query() query: OrderLookupQuery,
    @CurrentUser() user: AuthUser | null,
  ): Promise<CustomerOrderDto> {
    return this.orders.findForCustomer(orderNumber, query.phone, user);
  }

  @Post(':number/cancel')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: MINUTE } })
  @ApiOkResponse({ type: CustomerOrderDto })
  cancel(
    @Param('number') orderNumber: string,
    @Query() query: OrderLookupQuery,
    @CurrentUser() user: AuthUser | null,
  ): Promise<CustomerOrderDto> {
    return this.orders.cancelByCustomer(orderNumber, query.phone, user);
  }
}
